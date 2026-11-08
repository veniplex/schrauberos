import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GCM_TAG_BYTES, gcmParts, strictBase64 } from "@/lib/gcm";
import { isSecretKeyHex, WRAPPED_SETTING_KEY } from "@/lib/secret-wrap";
import { dataDir } from "@/lib/updates/store";
import { databaseFile } from "@/server/db-client-path";

/**
 * Verschlüsselung für Geheimnisse in der Datenbank (z. B. das Update-Token), AES-256-GCM. Der Schlüssel liegt als Datei im
 * Datenverzeichnis und ist bewusst NICHT Teil der Backups: Wer nur ein Backup besitzt, kann damit keine Geheimnisse lesen.
 *
 * **Zustandsmodell des Schlüssels** (`readSecretKey`) – davon hängt ab, was die Anwendung tun darf; im Zweifel wird nichts gelöscht:
 *  - `readable`: Datei vorhanden, 64 Hex-Zeichen. Nur hier kann man ver- und entschlüsseln. Schlägt dann die GCM-Prüfung eines Geheimnisses fehl, gehört es zu einem
 *    anderen Schlüssel oder ist beschädigt (`decryptSecret` → `null`).
 *  - `missing`: die Datei fehlt (ENOENT). Ist die Datenbank **frisch** (enthält noch kein verschlüsseltes Geheimnis und keine Hülle des Wiederherstellungsschlüssels), wird ein
 *    neuer Schlüssel angelegt. Enthält sie Geheimnisse, wird **nie still ein neuer angelegt** – das würde alle Geheimnisse unlesbar machen. Dann: `SecretKeyUnavailableError`.
 *  - `unreadable`: alles andere (Verzeichnis statt Datei, keine Leserechte, Ein-/Ausgabefehler, abgeschnittener oder fremder Inhalt). Die Datei wird nie überschrieben;
 *    `SecretKeyUnavailableError`. Das Beheben ist Sache der Person am Server.
 * `decryptSecret`/`encryptSecret` werfen also bei `missing`/`unreadable` – ein nicht lesbarer Schlüssel ist **kein** Grund, ein Geheimnis für „unlesbar“ zu halten und zurückzusetzen.
 * Zurücksetzen darf nur `secret-reset.ts` (und nur bei lesbarem Schlüssel, mit vorheriger Sicherung der betroffenen Zeilen).
 */

export const secretKeyFile = (data = dataDir()) => path.join(data, "secret.key");

export type SecretKeyState = { state: "readable"; hex: string } | { state: "missing" } | { state: "unreadable"; reason: string };

export class SecretKeyUnavailableError extends Error {
  constructor(readonly state: "missing" | "unreadable", detail?: string) {
    super(`secret.key ist ${state === "missing" ? "nicht vorhanden" : "nicht lesbar"}${detail ? ` (${detail})` : ""}`);
    this.name = "SecretKeyUnavailableError";
  }
}

/** Liest den Zustand des Schlüssels, ohne etwas zu verändern. */
export function readSecretKey(file = secretKeyFile()): SecretKeyState {
  let raw: string;
  try {
    raw = readFileSync(/*turbopackIgnore: true*/ file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? { state: "missing" } : { state: "unreadable", reason: code ?? "read" };
  }
  const hex = raw.trim();
  return isSecretKeyHex(hex) ? { state: "readable", hex } : { state: "unreadable", reason: "content" };
}

const SECRET_BLOB = /^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]*={0,2}$/;

/** Sieht der Wert nach einem mit `encryptSecret` verschlüsselten Geheimnis aus? (Form, nicht Inhalt – ob er lesbar ist, sagt `decryptSecret`.) */
export const isSecretBlob = (value: string): boolean => SECRET_BLOB.test(value);

/**
 * Was ist das für ein Geheimnis-Wert der Einstellungen (`v1:…`), ohne ihn zu öffnen? Wie bei gebundenen Blöcken (`boundBlobShape`, `b1`) und Tresorblöcken (`p1`): `ok` ist die Form von `v1`;
 * `unsupported` trägt eine andere, höhere Version (`v2:…` – von einem neueren Programm geschrieben, nicht beschädigt; bei einem Rückfall auf diese Version bleibt es unberührt);
 * `damaged` ist sonst nicht als Geheimnis geformt. Nur ein gut geformter `v1`-Wert, der mit dem lesbaren Schlüssel nicht aufgeht, ist „fremder Schlüssel“ (`isForeignSecret`).
 */
export function secretBlobShape(value: string): "ok" | "unsupported" | "damaged" {
  if (SECRET_BLOB.test(value)) return "ok";
  return /^v(?!1:)[1-9]\d*:/.test(value) ? "unsupported" : "damaged";
}

/**
 * **Die eine Regel für „unlesbar, darf zurückgesetzt werden“** (Einstellungen, zweiter Faktor, Verbraucher): ein gut geformter `v1`-Wert, den der (lesbare) Schlüssel dieses Datenträgers nicht
 * öffnet. Höhere Formatversionen (`v2:…`) und beschädigte Werte sind es nie – sie werden gemeldet, aber nicht automatisch angefasst. Wirft `SecretKeyUnavailableError`, wenn der Schlüssel nicht
 * lesbar ist (dann ist nichts „fremd“, sondern nur gerade nicht erreichbar).
 */
export function isForeignSecret(value: string): boolean {
  return isSecretBlob(value) && decryptSecret(value) === null;
}
const MARKER_KEYS = new Set([WRAPPED_SETTING_KEY, "secrets.keyCheck"]);

function currentDatabaseFile(): string | null {
  try {
    return databaseFile();
  } catch {
    return null;
  }
}

/**
 * Enthält die Datenbank (synchron, nur lesend) schon verschlüsselte Geheimnisse oder die Hülle eines Wiederherstellungsschlüssels? Dann darf nie still ein neuer Schlüssel
 * entstehen. Fehlt die Datenbank oder die Tabellen, ist sie frisch (nichts zu verlieren).
 */
export function databaseHoldsSecrets(file: string | null = currentDatabaseFile()): boolean {
  if (!file) return false;
  let db: Database.Database;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    return false;
  }
  try {
    // Ein Eintrag des IT-Tresors mit umhülltem Schlüssel gehört zu einem `secret.key`: auch dann darf nie still ein neuer entstehen (die Tabelle fehlt in alten Datenbanken: dann gibt es nichts zu schützen)
    try {
      if (db.prepare(`SELECT 1 FROM VaultEntry WHERE wrappedKey IS NOT NULL LIMIT 1`).get()) return true;
    } catch {
      /* keine Tresor-Tabelle */
    }
    if (db.prepare(`SELECT 1 FROM TwoFactor WHERE secret IS NOT NULL LIMIT 1`).get()) return true;
    for (const row of db.prepare(`SELECT key, value FROM AppSetting`).all() as Array<{ key: string; value: string }>) {
      if (MARKER_KEYS.has(row.key) || SECRET_BLOB.test(row.value)) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** Legt die Schlüsseldatei atomar an (erst vollständig in eine Nebendatei, dann per harter Verknüpfung – schlägt fehl, wenn es die Datei schon gibt; nie ein halber Schlüssel). */
export function writeSecretKeyFile(hex: string, file = secretKeyFile()): void {
  if (!isSecretKeyHex(hex)) throw new Error("Ungültiger Geheimnisschlüssel.");
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, hex, { mode: 0o600, flag: "wx" });
  try {
    linkSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    // Dateisysteme ohne Rechte (Windows)
  }
}

/** Legt einen neuen zufälligen Schlüssel an (nur wenn die Datei fehlt). Der Aufrufer entscheidet, ob das erlaubt ist (frische Datenbank, oder ausdrücklicher Neuanfang durch die Administration). */
export function createSecretKey(file = secretKeyFile()): string {
  const hex = randomBytes(32).toString("hex");
  writeSecretKeyFile(hex, file);
  return hex;
}

/** Stellt sicher, dass es einen Schlüssel gibt, wo das gefahrlos ist (frische Datenbank). Liefert den Zustand danach. Wird beim Start aufgerufen. */
export function ensureSecretKey(): SecretKeyState {
  const current = readSecretKey();
  if (current.state === "missing" && !databaseHoldsSecrets()) {
    try {
      createSecretKey();
    } catch {
      // ein Wettlauf oder nicht beschreibbar: der Zustand unten sagt es
    }
    return readSecretKey();
  }
  return current;
}

/** Der Geheimnisschlüssel als Hex-Text (64 Zeichen). Wirft `SecretKeyUnavailableError`, wenn er fehlt (und die Datenbank schon Geheimnisse enthält) oder nicht lesbar ist. */
export function secretKeyHex(): string {
  const state = ensureSecretKey();
  if (state.state === "readable") return state.hex;
  throw new SecretKeyUnavailableError(state.state, state.state === "unreadable" ? state.reason : undefined);
}

/** Datei `secret.key` zur Seite legen (statt sie zu löschen), z. B. beim Ersetzen durch den rekonstruierten Schlüssel. Gibt den neuen Pfad zurück. */
export function setAsideSecretKey(file = secretKeyFile()): string {
  const target = `${file}.replaced-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "")}Z`;
  renameSync(file, target);
  return target;
}

const key = (): Buffer => Buffer.from(secretKeyHex(), "hex");

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: GCM_TAG_BYTES });
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/**
 * Entschlüsselt. `null` heißt: gehört zu einem anderen Schlüssel oder ist beschädigt (GCM-Prüfung/Format) – und zwar **bei lesbarem Schlüssel**. Fehlt der Schlüssel oder ist er
 * nicht lesbar, wirft die Funktion `SecretKeyUnavailableError` (nie `null`): „ich kann nicht lesen“ ist etwas anderes als „das ist nicht von mir“.
 */
export function decryptSecret(blob: string): string | null {
  return decryptSecretWith(blob, key());
}

/**
 * Umhüllung mit **gebundenem Kontext** (für Schlüssel, die zu genau einer Zeile gehören, z. B. der Eintragsschlüssel des IT-Tresors): dieselbe AES-256-GCM-Verschlüsselung mit dem Schlüssel aus `secret.key` und
 * zufälliger 12-Byte-Nonce, aber `aad` (z. B. `schrauberos:vault:dek:v1:<Eintrags-ID>`) ist zusätzlich authentifiziert – in eine andere Zeile verschoben lässt sich der Block nicht mehr öffnen.
 * Format `b1:<Nonce>:<Tag>:<Daten>` (Base64); es ist **kein** `v1`-Geheimnis der Einstellungen (`isSecretBlob` erkennt es nicht, der Einstellungs-Reset fasst es nie an).
 * Wirft `SecretKeyUnavailableError`, wenn der Schlüssel fehlt oder nicht lesbar ist (nie still ein anderer Weg).
 */
export function encryptSecretBound(plain: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: GCM_TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return ["b1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Gegenstück zu `encryptSecretBound`: `null`, wenn der Schlüssel dieses Datenträgers den Block nicht öffnet (fremder Schlüssel, falscher Kontext, beschädigt); wirft `SecretKeyUnavailableError`, wenn er nicht lesbar ist. */
export function decryptSecretBound(blob: string, aad: string): Buffer | null {
  return decryptSecretBoundWith(blob, aad, key());
}

/** Wie `decryptSecretBound` mit einem gegebenen Schlüssel (Hex oder Bytes). */
export function decryptSecretBoundWith(blob: string, aad: string, secretKey: Buffer | string): Buffer | null {
  try {
    const shape = parseBound(blob);
    if (!shape) return null;
    const decipher = createDecipheriv("aes-256-gcm", typeof secretKey === "string" ? Buffer.from(secretKey, "hex") : secretKey, shape.iv, { authTagLength: GCM_TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(shape.tag);
    return Buffer.concat([decipher.update(shape.data), decipher.final()]);
  } catch {
    return null;
  }
}

/** Form eines gebundenen Blocks: Version `b1`, vier Teile, IV 12 und Tag 16 Byte, kanonisches Base64. */
function parseBound(blob: string): { iv: Buffer; tag: Buffer; data: Buffer } | null {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "b1") return null;
  const gcm = gcmParts(parts[1], parts[2]);
  const data = strictBase64(parts[3]);
  return gcm && data ? { ...gcm, data } : null;
}

/**
 * Was ist das für ein gebundener Block, ohne ihn zu öffnen? `ok`: Form von `b1`; `unsupported`: trägt eine andere, höhere Version (`b2:…` – von einem neueren Programm geschrieben, nicht beschädigt);
 * `damaged`: sonst nicht lesbar geformt (Teile, Länge, Kodierung). Für den Tresor: nur ein Block, der *gut geformt* ist und mit dem Schlüssel nicht aufgeht, ist „fremder Schlüssel“.
 */
export function boundBlobShape(blob: string): "ok" | "unsupported" | "damaged" {
  if (parseBound(blob)) return "ok";
  return /^b(?!1:)[1-9]\d*:/.test(blob) ? "unsupported" : "damaged";
}

/** Wie `decryptSecret`, aber mit einem gegebenen Schlüssel (Hex) statt der Datei – z. B. um zu prüfen, ob ein aufgehobener Schlüssel zu einer Datenbank passt. `null`: passt nicht oder beschädigt. */
export function decryptSecretWith(blob: string, key: Buffer | string): string | null {
  try {
    const parts = blob.split(":");
    if (parts.length !== 4 || parts[0] !== "v1") return null;
    const gcm = gcmParts(parts[1], parts[2]);
    const data = strictBase64(parts[3]);
    if (!gcm || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", typeof key === "string" ? Buffer.from(key, "hex") : key, gcm.iv, { authTagLength: GCM_TAG_BYTES });
    decipher.setAuthTag(gcm.tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
