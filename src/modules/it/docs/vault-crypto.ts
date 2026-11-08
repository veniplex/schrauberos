import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decryptSecretBound, encryptSecretBound } from "@/server/secrets";
import { VAULT_LIMITS } from "./vault-constants";

/**
 * Kryptographie des IT-Tresors (Envelope-Verschlüsselung, README „IT-Tresor“):
 *
 *  - Je Eintrag und je Speichern ein **neuer zufälliger 256-Bit-Eintragsschlüssel (DEK)**. Er verschlüsselt den Nutzdatenblock (URL, Benutzername, Geheimnis, Notiz als JSON) mit **AES-256-GCM** und einer
 *    **zufälligen 12-Byte-IV** (nie wiederverwendet; jedes Verschlüsseln würfelt neu). Zusätzlich authentifiziert (AAD): `schrauberos:vault:payload:v<Format>:<Eintrags-ID>:<Revision>` – ein Block lässt sich
 *    nicht in einen anderen Eintrag, in ein anderes Format oder unter eine andere Revision verschieben.
 *  - Der DEK selbst ist mit dem **Schlüssel aus `secret.key`** umhüllt (`encryptSecretBound` in `server/secrets.ts`: derselbe einheitliche Geheimnis-Mechanismus, AES-256-GCM, zufällige Nonce), gebunden an
 *    `schrauberos:vault:dek:v<Format>:<Eintrags-ID>`. Damit hängt der Tresor an demselben Schlüssel wie alle anderen Geheimnisse: Wer `secret.key` über den **Wiederherstellungsschlüssel** zurückholt
 *    (`recovery-key.ts`), kann auch den Tresor wieder lesen; ohne passenden Schlüssel bleibt er unlesbar, aber nicht zerstört.
 *  - **Fail-closed:** Fehlt `secret.key` oder ist er nicht lesbar, werfen Öffnen und Verschlüsseln `SecretKeyUnavailableError` – nie ein stilles „leer“.
 *
 * Der Klartext verlässt dieses Modul nur als Rückgabewert von `openVaultEntry`; er wird nirgends geloggt oder gespeichert.
 */
export const VAULT_FORMAT = 1;
const PAYLOAD_PREFIX = "p1";

export type VaultSecret = { url: string; username: string; secret: string; note: string };
export const EMPTY_SECRET: VaultSecret = { url: "", username: "", secret: "", note: "" };

export const hasContent = (s: VaultSecret): boolean => Boolean(s.url || s.username || s.secret || s.note);

const payloadAad = (id: string, format: number, revision: number) => `schrauberos:vault:payload:v${format}:${id}:${revision}`;
const keyAad = (id: string, format: number) => `schrauberos:vault:dek:v${format}:${id}`;

export type SealedEntry = { format: number; revision: number; wrappedKey: string; payload: string };

/** Verschlüsselt die Zugangsdaten eines Eintrags unter einem **neuen** Eintragsschlüssel und einer neuen IV. */
export function sealVaultEntry(id: string, revision: number, secret: VaultSecret): SealedEntry {
  const dek = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    cipher.setAAD(Buffer.from(payloadAad(id, VAULT_FORMAT, revision), "utf8"));
    const data = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
    const payload = [PAYLOAD_PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
    return { format: VAULT_FORMAT, revision, wrappedKey: encryptSecretBound(dek, keyAad(id, VAULT_FORMAT)), payload };
  } finally {
    dek.fill(0);
  }
}

export type OpenResult =
  | { ok: true; secret: VaultSecret }
  /** `empty`: keine Zugangsdaten hinterlegt; `unreadable`: der Schlüssel dieses Datenträgers öffnet den Eintragsschlüssel nicht (fremder Schlüssel); `damaged`: Block verändert, verschoben oder in einem unbekannten Format */
  | { ok: false; reason: "empty" | "unreadable" | "damaged" };

const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);

/** Öffnet die Zugangsdaten eines Eintrags. Wirft `SecretKeyUnavailableError`, wenn `secret.key` fehlt oder nicht lesbar ist. */
export function openVaultEntry(entry: { id: string; format: number; revision: number; wrappedKey: string | null; payload: string | null }): OpenResult {
  if (!entry.wrappedKey || !entry.payload) return { ok: false, reason: "empty" };
  if (entry.format !== VAULT_FORMAT) return { ok: false, reason: "damaged" };
  const dek = decryptSecretBound(entry.wrappedKey, keyAad(entry.id, entry.format));
  if (dek === null) return { ok: false, reason: "unreadable" };
  try {
    if (dek.length !== 32) return { ok: false, reason: "damaged" };
    const parts = entry.payload.split(":");
    // genau vier Teile: Anhängsel hinter dem Block gehören nicht dazu
    if (parts.length !== 4 || parts[0] !== PAYLOAD_PREFIX || !parts[1] || !parts[2]) return { ok: false, reason: "damaged" };
    const [, iv, tag, data] = parts;
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(payloadAad(entry.id, entry.format, entry.revision), "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const json = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")) as Record<string, unknown>;
    const url = text(json.url, VAULT_LIMITS.url);
    const username = text(json.username, VAULT_LIMITS.username);
    const secret = text(json.secret, VAULT_LIMITS.secret);
    const note = text(json.note, VAULT_LIMITS.note);
    if (url === null || username === null || secret === null || note === null) return { ok: false, reason: "damaged" };
    return { ok: true, secret: { url, username, secret, note } };
  } catch {
    return { ok: false, reason: "damaged" };
  } finally {
    dek.fill(0);
  }
}
