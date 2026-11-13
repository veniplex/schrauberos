import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { GCM_IV_BYTES, GCM_TAG_BYTES, gcmParts, strictBase64 } from "./gcm";

/**
 * **Schlüsselkonzept des IT-Tresors** (Entscheid des Besitzers, Block 14; README „IT-Tresor“): Reine Funktionen ohne Datei-, Datenbank- und Prozesszugriff.
 *
 *  - Der **Tresor-Hauptschlüssel** (256 Bit, zufällig) wird nie gespeichert. Er liegt nur im Speicher des Prozesses (`server/vault-keyring.ts`) und umhüllt die **Eintragsschlüssel** (DEK) der Einträge
 *    (`wrapEntryKey`, AES-256-GCM, AAD = Eintrags-ID und Format wie bisher).
 *  - Gespeichert sind nur **Hüllen** des Hauptschlüssels: (1) unter einem Schlüssel, der per **scrypt aus der Tresor-Passphrase** abgeleitet wird (`deriveKek`, Salz und Kosten stehen im Datensatz; die GCM-Prüfung
 *    der Hülle ist zugleich die Prüfung der Passphrase), (2) optional unter einem aus dem **Wiederherstellungsschlüssel** abgeleiteten Schlüssel (`recoveryKek`, HKDF; „ein Schlüssel für alles“). Dazu ein
 *    **Prüfwert** (`keyCheck`, HMAC eines festen Textes unter dem Hauptschlüssel – verrät nichts über ihn), der bestätigt, dass ein geöffneter Schlüssel der richtige ist.
 *  - Die Passphrase zu ändern tauscht nur die Hülle (neues Salz, neuer Schlüssel): die Einträge werden nicht neu verschlüsselt.
 *
 * Alle Hüllen sind AES-256-GCM mit zufälliger 12-Byte-IV und festgenageltem 16-Byte-Tag (`lib/gcm.ts`), mit Zweck und Version als zusätzlich authentifizierten Daten (AAD): eine Hülle des einen Zwecks öffnet nie als
 * die eines anderen. Formate: Hauptschlüssel `m1:<IV>:<Tag>:<Daten>`, Eintragsschlüssel `k2:<IV>:<Tag>:<Daten>` (Base64, kanonisch).
 */
export const KEYRING_VERSION = 1;
export const ENTRY_KEY_FORMAT = 2;
export const MASTER_KEY_BYTES = 32;

/**
 * scrypt-Kosten der Tresor-Passphrase: N = 2^17 (128 MiB), r = 8, p = 1 – bewusst deutlich über der Anmeldung (die Passphrase wird selten und nur von Berechtigten eingegeben).
 * **Warum nicht höher (Entscheid, Block 15):** N = 2^18 braucht über 256 MiB je Berechnung (auf einem Pi/NAS nicht tragbar, zusammen mit Node und der Datenbank); p = 2 verdoppelte nur die Rechenzeit (auf kleinen Geräten
 * mehrere Sekunden je Entsperren, gedrosselt global). Den Schutz gegen Offline-Raten auf einem Backup trägt darum die **Länge der Passphrase** (mindestens 16 Zeichen), nicht die Kosten.
 */
export const VAULT_SCRYPT = { N: 2 ** 17, r: 8, p: 1 } as const;
export type ScryptParams = { N: number; r: number; p: number };
/** Obergrenzen für gespeicherte Kosten (ein manipulierter Datensatz soll keinen riesigen Speicherbedarf auslösen) und Untergrenze (eine abgesenkte Kostenangabe ist ein Angriff auf die Passphrase). */
const MIN_N = 2 ** 14;
const MAX_N = 2 ** 18;

/**
 * Sind das zulässige scrypt-Kosten? (N Zweierpotenz zwischen 2^14 und 2^18, **r 1–8, p 1–2**: mehr braucht die eigene Wahl `VAULT_SCRYPT` nicht; ein feindlicher Datensatz soll weder Speicher noch
 * Rechenzeit über das Maß der eigenen Parameter hinaus belegen.) In Tests dürfen kleinere Kosten gelten (`setVaultScryptForTests`).
 */
export function validScryptParams(params: ScryptParams, minN = MIN_N): boolean {
  const { N, r, p } = params;
  return Number.isInteger(N) && N >= minN && N <= MAX_N && (N & (N - 1)) === 0 && Number.isInteger(r) && r >= 1 && r <= 8 && Number.isInteger(p) && p >= 1 && p <= 2;
}

/** Leitet aus der Passphrase den Umhüllungsschlüssel ab (scrypt, NFKC, 32 Byte). Läuft im Thread-Pool; der Aufrufer reiht die Berechnung in den Eigentümer-Pfad ein (`server/vault-keyring.ts`). */
export function deriveKek(passphrase: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(passphrase.normalize("NFKC"), salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 160 * params.N * params.r }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export const PASSPHRASE_MIN_CHARS = 16;
export const PASSPHRASE_MAX_CHARS = 256;
/** Häufige Passphrasen (Kleinschreibung, ohne Leerzeichen und Trenner) – bewusst klein: die Länge trägt den Schutz */
const COMMON = ["passwortpasswort", "passwort1234", "password1234", "passphrasepassphrase", "123456789012", "qwertzuiopasdf", "qwertyuiopasdf", "schrauberos123", "werkstattwerkstatt", "tresortresor"];

/** Ist der Text (Kleinschreibung, nur Buchstaben und Ziffern) eine Wiederholung eines kurzen Bausteins (`abcabcabc…`, `PasswortPasswort…`)? */
function repeatsShortUnit(flat: string): boolean {
  for (let unit = 1; unit <= flat.length / 2; unit++) {
    if (flat.length % unit === 0 && flat === flat.slice(0, unit).repeat(flat.length / unit)) return true;
  }
  return false;
}

/** Besteht der Text überwiegend aus aufeinanderfolgenden Zeichen (`abcdefgh…`, `12345678…`, auch absteigend)? */
function mostlySequential(flat: string): boolean {
  const codes = [...flat].map((c) => c.codePointAt(0)!);
  let steps = 0;
  for (let i = 1; i < codes.length; i++) if (Math.abs(codes[i] - codes[i - 1]) === 1) steps++;
  return codes.length >= 8 && steps >= (codes.length - 1) * 0.6;
}

export type PassphraseProblem = "tooShort" | "tooLong" | "weak" | "username";

/**
 * **Mindestqualität der Tresor-Passphrase:** mindestens **16 Zeichen** (NFKC, höchstens 256), mindestens 8 verschiedene Zeichen, nicht nur Ziffern, keine Wiederholung eines kurzen Bausteins, keine Zeichenfolge
 * (`abcdefgh…`), nicht der Benutzername (auch nicht mit Ziffern dahinter), keine der bekannten häufigen Passphrasen. Mehr wird nicht verlangt (ein Satz aus Wörtern genügt): Die Passphrase ist der **einzige Schutz
 * gegen Offline-Raten** auf einer Kopie der Datenbank (jedes Backup enthält die Hülle), die Länge trägt ihn.
 */
export function passphraseProblem(passphrase: string, context: { username?: string } = {}): PassphraseProblem | null {
  const text = passphrase.normalize("NFKC");
  const chars = [...text];
  if (chars.length < PASSPHRASE_MIN_CHARS) return "tooShort";
  if (chars.length > PASSPHRASE_MAX_CHARS) return "tooLong";
  if (new Set(chars).size < 8 || /^[0-9\s]+$/.test(text)) return "weak";
  const flat = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (COMMON.includes(flat) || repeatsShortUnit(flat) || mostlySequential(flat)) return "weak";
  const user = context.username?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (user && user.length >= 3 && flat.startsWith(user) && /^[0-9]*$/.test(flat.slice(user.length))) return "username";
  return null;
}

export const newMasterKey = (): Buffer => randomBytes(MASTER_KEY_BYTES);

const masterAad = (purpose: "passphrase" | "recovery") => Buffer.from(`schrauberos:vault:master:v${KEYRING_VERSION}:${purpose}`, "utf8");

function seal(plain: Buffer, key: Buffer, aad: Buffer, prefix: string): string {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [prefix, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

function open(blob: string, key: Buffer, aad: Buffer, prefix: string): Buffer | null {
  try {
    const parts = blob.split(":");
    if (parts.length !== 4 || parts[0] !== prefix) return null;
    const gcm = gcmParts(parts[1], parts[2]);
    const data = strictBase64(parts[3]);
    if (!gcm || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, gcm.iv, { authTagLength: GCM_TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(gcm.tag);
    const first = decipher.update(data);
    try {
      const last = decipher.final();
      const plain = Buffer.concat([first, last]);
      last.fill(0);
      return plain;
    } finally {
      first.fill(0); // Zwischenpuffer mit Klartext (Schlüsselmaterial) nicht liegen lassen
    }
  } catch {
    return null;
  }
}

/** Form der Hülle des Hauptschlüssels (ohne zu öffnen): `ok`, `unsupported` (andere, höhere Version: Rückfall nach einem Update) oder `damaged`. */
export function masterWrapShape(blob: string): "ok" | "unsupported" | "damaged" {
  const parts = blob.split(":");
  if (parts[0] === "m1") return parts.length === 4 && gcmParts(parts[1], parts[2]) && strictBase64(parts[3]) ? "ok" : "damaged";
  return /^m(?!1:)[1-9]\d*:/.test(blob) ? "unsupported" : "damaged";
}

/** Hauptschlüssel unter einem Umhüllungsschlüssel (`passphrase`: aus der Tresor-Passphrase, `recovery`: aus dem Wiederherstellungsschlüssel). */
export const wrapMaster = (master: Buffer, kek: Buffer, purpose: "passphrase" | "recovery"): string => seal(master, kek, masterAad(purpose), "m1");

/** Öffnet die Hülle; `null` bei falschem Schlüssel oder beschädigten Daten (nicht unterscheidbar) und wenn der Inhalt keine 32 Byte hat. */
export function unwrapMaster(blob: string, kek: Buffer, purpose: "passphrase" | "recovery"): Buffer | null {
  const master = open(blob, kek, masterAad(purpose), "m1");
  if (master && master.length === MASTER_KEY_BYTES) return master;
  master?.fill(0);
  return null;
}

/** Prüfwert eines Hauptschlüssels (HMAC eines festen Textes): erkennt den richtigen Schlüssel, ohne etwas über ihn zu verraten. */
export const keyCheck = (master: Buffer): string => createHmac("sha256", master).update(`schrauberos:vault:key-check:v${KEYRING_VERSION}`).digest("hex");

export function masterMatches(master: Buffer, check: string): boolean {
  const expected = Buffer.from(keyCheck(master), "hex");
  const given = /^[0-9a-f]{64}$/.test(check) ? Buffer.from(check, "hex") : null;
  return given !== null && timingSafeEqual(expected, given);
}

/** Umhüllungsschlüssel aus dem Wiederherstellungsschlüssel (HKDF-SHA256, eigene Kontextangabe – unabhängig von der Hülle von `secret.key` und vom Off-Site-Schlüssel). */
export const recoveryKek = (recoveryKey: Buffer): Buffer => Buffer.from(hkdfSync("sha256", recoveryKey, Buffer.alloc(0), "schrauberos-vault-master-wrap-v1", 32));

const entryAad = (id: string, format: number) => Buffer.from(`schrauberos:vault:dek:v${format}:${id}`, "utf8");

/** Eintragsschlüssel (DEK) eines Eintrags unter dem Hauptschlüssel. */
export const wrapEntryKey = (dek: Buffer, master: Buffer, id: string): string => seal(dek, master, entryAad(id, ENTRY_KEY_FORMAT), "k2");

/** Form der Hülle eines Eintragsschlüssels (ohne zu öffnen): `ok`, `unsupported` (andere, höhere Version) oder `damaged`. */
export function entryKeyShape(blob: string): "ok" | "unsupported" | "damaged" {
  const parts = blob.split(":");
  if (parts[0] === "k2") return parts.length === 4 && gcmParts(parts[1], parts[2]) && strictBase64(parts[3]) ? "ok" : "damaged";
  return /^k(?!2:)[1-9]\d*:/.test(blob) ? "unsupported" : "damaged";
}

/** Öffnet die Hülle eines Eintragsschlüssels (32 Byte) oder `null`. */
export function unwrapEntryKey(blob: string, master: Buffer, id: string): Buffer | null {
  const dek = open(blob, master, entryAad(id, ENTRY_KEY_FORMAT), "k2");
  if (dek && dek.length === 32) return dek;
  dek?.fill(0);
  return null;
}
