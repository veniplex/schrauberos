import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/updates/store";

/**
 * Verschlüsselung für Geheimnisse in der Datenbank (z. B. das Update-Token), AES-256-GCM. Der Schlüssel liegt als Datei im
 * Datenverzeichnis und ist bewusst NICHT Teil der Backups: Wer nur ein Backup besitzt, kann damit keine Geheimnisse lesen.
 * Nach einem Restore auf einem anderen System müssen sie neu eingegeben werden.
 */

export const secretKeyFile = (data = dataDir()) => path.join(data, "secret.key");
const keyFile = () => secretKeyFile();

function key(): Buffer {
  return Buffer.from(secretKeyHex(), "hex");
}

/** Der Geheimnisschlüssel als Hex-Text (64 Zeichen); fehlt die Datei, wird ein neuer erzeugt. Nur für die Umhüllung mit dem Wiederherstellungsschlüssel (`recovery-key.ts`) – sonst nie weitergeben. */
export function secretKeyHex(): string {
  const file = keyFile();
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  return readFileSync(file, "utf8").trim();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Entschlüsselt; null bei fremdem Schlüssel oder beschädigten Daten. */
export function decryptSecret(blob: string): string | null {
  try {
    const [version, iv, tag, data] = blob.split(":");
    if (version !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
