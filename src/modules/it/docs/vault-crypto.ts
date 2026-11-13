import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { GCM_TAG_BYTES, gcmParts, strictBase64 } from "@/lib/gcm";
import { ENTRY_KEY_FORMAT, entryKeyShape, unwrapEntryKey, wrapEntryKey } from "@/lib/vault-keys";
import { vaultMasterKey } from "@/server/vault-keyring";
import { VAULT_LIMITS } from "./vault-constants";

/**
 * Kryptographie des IT-Tresors (Envelope-Verschlüsselung, README „IT-Tresor“):
 *
 *  - Je Eintrag und je Speichern ein **neuer zufälliger 256-Bit-Eintragsschlüssel (DEK)**. Er verschlüsselt den Nutzdatenblock (URL, Benutzername, Geheimnis, Notiz als JSON) mit **AES-256-GCM** (16-Byte-Tag
 *    festgenagelt, `lib/gcm.ts`) und einer **zufälligen 12-Byte-IV** (nie wiederverwendet; jedes Verschlüsseln würfelt neu). Zusätzlich authentifiziert (AAD): `schrauberos:vault:payload:v<Format>:<Eintrags-ID>:<Revision>:<Beschriftung>`
 *    – ein Block lässt sich nicht in einen anderen Eintrag, in ein anderes Format oder unter eine andere Revision verschieben, und **Titel, Art und System** (`<Beschriftung>` = Kurzwert davon) sind mit dem Block
 *    verbunden: wer in der Datenbank Beschriftungen zwischen Einträgen vertauscht, bekommt einen nicht mehr lesbaren Eintrag statt der falschen Zugangsdaten unter einem vertrauten Titel. Folge: Ändert sich eine
 *    der drei Angaben, wird der Block neu verschlüsselt (dazu muss er lesbar sein). **Grenze:** Die Zeile als Ganzes lässt sich zurückspielen (alte Revision samt altem Block und Schlüssel) – das erkennt das
 *    Format nicht (die Revision schützt gegen das Mischen von Teilen, nicht gegen einen älteren, in sich stimmigen Stand).
 *  - Der DEK selbst ist mit dem **Tresor-Hauptschlüssel** umhüllt (`wrapEntryKey` in `lib/vault-keys.ts`, AES-256-GCM, zufällige IV, AAD = Format und Eintrags-ID). Den Hauptschlüssel gibt es nur im Speicher des
 *    Prozesses (`server/vault-keyring.ts`): Er entsteht aus der **Tresor-Passphrase** (scrypt, Hülle in der Datenbank) bzw. dem Wiederherstellungsschlüssel. **Der Tresor hängt nicht mehr an `secret.key`.**
 *  - **Gesperrt = fail-closed:** Ist der Tresor gesperrt (nach jedem Neustart, bis ein Berechtigter die Passphrase eingibt) oder nicht eingerichtet, werfen Öffnen und Verschlüsseln `VaultLockedError` – nie ein stilles „leer“.
 *  - **Was beim Öffnen herauskommt** (`OpenResult`): Ein unbekanntes Format (neuere Version, abgesenkte Feldgrenzen) ist `unsupported`, ein veränderter, verschobener oder schlecht geformter Block `damaged`: beides wird
 *    gemeldet, nie automatisch zurückgesetzt. (Ein Eintragsschlüssel, der unter dem richtigen Hauptschlüssel nicht aufgeht, ist beschädigt – „fremder Schlüssel“ gibt es nicht mehr.)
 *
 * Der Klartext verlässt dieses Modul nur als Rückgabewert von `openVaultEntry`; er wird nirgends geloggt oder gespeichert.
 */
export const VAULT_FORMAT = ENTRY_KEY_FORMAT;
const PAYLOAD_PREFIX = "p1";

export type VaultSecret = { url: string; username: string; secret: string; note: string };
export const EMPTY_SECRET: VaultSecret = { url: "", username: "", secret: "", note: "" };

export const hasContent = (s: VaultSecret): boolean => Boolean(s.url || s.username || s.secret || s.note);

/** Beschriftung eines Eintrags (Klartext in der Liste): sie ist mit dem Block verbunden (AAD) */
export type VaultLabel = { title: string; kind: string; system: string | null };

const labelDigest = (label: VaultLabel): string => createHash("sha256").update(JSON.stringify([label.title, label.kind, label.system ?? ""])).digest("hex").slice(0, 32);
const payloadAad = (id: string, format: number, revision: number, label: VaultLabel) => `schrauberos:vault:payload:v${format}:${id}:${revision}:${labelDigest(label)}`;

export type SealedEntry = { format: number; revision: number; wrappedKey: string; payload: string };

/** Verschlüsselt die Zugangsdaten eines Eintrags unter einem **neuen** Eintragsschlüssel und einer neuen IV. */
export function sealVaultEntry(id: string, revision: number, label: VaultLabel, secret: VaultSecret): SealedEntry {
  const dek = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv, { authTagLength: GCM_TAG_BYTES });
    cipher.setAAD(Buffer.from(payloadAad(id, VAULT_FORMAT, revision, label), "utf8"));
    const data = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
    const payload = [PAYLOAD_PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
    return { format: VAULT_FORMAT, revision, wrappedKey: wrapEntryKey(dek, vaultMasterKey(), id), payload };
  } finally {
    dek.fill(0);
  }
}

export type OpenResult =
  | { ok: true; secret: VaultSecret }
  /**
   * `empty`: keine Zugangsdaten hinterlegt; `unsupported`: Format, Version oder Feldgrenzen, die dieses Programm nicht kennt (neuere Version) – nie zurücksetzen; `damaged`: Block verändert, verschoben oder schlecht
   * geformt – melden, nie automatisch zurücksetzen
   */
  | { ok: false; reason: "empty" | "unsupported" | "damaged" };

const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);

type Payload = { iv: Buffer; tag: Buffer; data: Buffer };

/** Form des Nutzdatenblocks: `p1:<IV>:<Tag>:<Daten>`, genau vier Teile, kanonisches Base64, IV 12 und Tag 16 Byte; eine andere, höhere Version ist `unsupported`. */
function parsePayload(payload: string): Payload | "unsupported" | "damaged" {
  const parts = payload.split(":");
  if (parts[0] !== PAYLOAD_PREFIX) return /^p(?!1:)[1-9]\d*:/.test(payload) ? "unsupported" : "damaged";
  if (parts.length !== 4) return "damaged";
  const gcm = gcmParts(parts[1], parts[2]);
  const data = strictBase64(parts[3]);
  return gcm && data ? { ...gcm, data } : "damaged";
}

export type VaultRow = VaultLabel & { id: string; format: number; revision: number; wrappedKey: string | null; payload: string | null };

/** Öffnet die Zugangsdaten eines Eintrags. Wirft `VaultLockedError`, wenn der Tresor gesperrt (oder nicht eingerichtet) ist und der Eintrag einen Block hat. */
export function openVaultEntry(entry: VaultRow): OpenResult {
  if (!entry.wrappedKey || !entry.payload) return { ok: false, reason: "empty" };
  if (entry.format !== VAULT_FORMAT) return { ok: false, reason: "unsupported" };
  const wrapped = entryKeyShape(entry.wrappedKey);
  if (wrapped !== "ok") return { ok: false, reason: wrapped };
  const payload = parsePayload(entry.payload);
  if (typeof payload === "string") return { ok: false, reason: payload };
  const dek = unwrapEntryKey(entry.wrappedKey, vaultMasterKey(), entry.id);
  // Der Hauptschlüssel ist geprüft (Prüfwert): geht der Eintragsschlüssel damit nicht auf, ist er verändert oder in einen anderen Eintrag verschoben
  if (dek === null) return { ok: false, reason: "damaged" };
  try {
    if (dek.length !== 32) return { ok: false, reason: "damaged" };
    let json: Record<string, unknown>;
    try {
      const decipher = createDecipheriv("aes-256-gcm", dek, payload.iv, { authTagLength: GCM_TAG_BYTES });
      decipher.setAAD(Buffer.from(payloadAad(entry.id, entry.format, entry.revision, entry), "utf8"));
      decipher.setAuthTag(payload.tag);
      json = JSON.parse(Buffer.concat([decipher.update(payload.data), decipher.final()]).toString("utf8")) as Record<string, unknown>;
    } catch {
      // Der Eintragsschlüssel ist da, der Block geht nicht auf (oder ist kein JSON): verändert, verschoben, unter anderer Revision/Beschriftung – nicht „fremder Schlüssel“
      return { ok: false, reason: "damaged" };
    }
    // Der Block ist echt (GCM-geprüft), hat aber eine Form, die dieses Programm nicht kennt (andere Felder, abgesenkte Grenzen): neuere Version, nicht beschädigt
    const url = text(json?.url, VAULT_LIMITS.url);
    const username = text(json?.username, VAULT_LIMITS.username);
    const secret = text(json?.secret, VAULT_LIMITS.secret);
    const note = text(json?.note, VAULT_LIMITS.note);
    if (url === null || username === null || secret === null || note === null) return { ok: false, reason: "unsupported" };
    return { ok: true, secret: { url, username, secret, note } };
  } finally {
    dek.fill(0);
  }
}
