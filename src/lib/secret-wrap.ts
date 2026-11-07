import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Umhüllung des Geheimnisschlüssels (`secret.key`) mit dem Wiederherstellungsschlüssel (256 Bit, siehe `recovery-key.ts`). Reine Funktionen ohne Datei- und Datenbankzugriff.
 *
 *  - Aus dem Wiederherstellungsschlüssel werden per HKDF-SHA256 **zwei unabhängige Schlüssel** abgeleitet (verschiedene Kontextangaben): einer zum Umhüllen von `secret.key`
 *    (`wrapSecretKey`/`unwrapSecretKey`), einer als Hauptschlüssel der Off-Site-Verschlüsselung (`deriveOffsiteMasterKey`).
 *  - Die Hülle ist AES-256-GCM mit zufälligem Salz (in die Ableitung) und zufälliger Nonce; Kontext und Version stehen als zusätzlich authentifizierte Daten (AAD) darin.
 *  - `secretKeyCheck` ist ein Kennwert von `secret.key` (HMAC), der nichts über den Schlüssel verrät – damit lässt sich erkennen, ob die Hülle in der Datenbank noch zum Schlüssel dieses
 *    Datenträgers gehört (nach einem Restore ohne Schlüssel nicht mehr).
 */
const WRAP_INFO = "schrauberos-secret-key-wrap-v1";
const OFFSITE_INFO = "schrauberos-offsite-master-v1";
const AAD = Buffer.from("schrauberos:secret-key-wrap:v1");

const derive = (recoveryKey: Buffer, salt: Buffer, info: string): Buffer => Buffer.from(hkdfSync("sha256", recoveryKey, salt, info, 32));

/** `secret.key` ist 32 Byte hexadezimal (64 Zeichen). */
export const isSecretKeyHex = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

/** Umhüllt den Geheimnisschlüssel (Hex) mit dem Wiederherstellungsschlüssel. Format: `w1:<Salz>:<Nonce>:<Tag>:<Daten>` (Base64). */
export function wrapSecretKey(secretKeyHex: string, recoveryKey: Buffer): string {
  if (!isSecretKeyHex(secretKeyHex)) throw new Error("Ungültiger Geheimnisschlüssel.");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(recoveryKey, salt, WRAP_INFO), iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(secretKeyHex, "utf8"), cipher.final()]);
  return ["w1", salt.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Öffnet die Hülle; null bei falschem Schlüssel oder beschädigten Daten (nicht unterscheidbar). */
export function unwrapSecretKey(blob: string, recoveryKey: Buffer): string | null {
  try {
    const [version, salt, iv, tag, data] = blob.split(":");
    if (version !== "w1") return null;
    const decipher = createDecipheriv("aes-256-gcm", derive(recoveryKey, Buffer.from(salt, "base64"), WRAP_INFO), Buffer.from(iv, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
    return isSecretKeyHex(plain) ? plain : null;
  } catch {
    return null;
  }
}

/** Hauptschlüssel der Off-Site-Verschlüsselung (aus dem Wiederherstellungsschlüssel; der Server verwahrt ihn verschlüsselt als Geheimnis, damit er unbeaufsichtigt sichern kann). */
export const deriveOffsiteMasterKey = (recoveryKey: Buffer): Buffer => derive(recoveryKey, Buffer.alloc(0), OFFSITE_INFO);

/** Kennwert eines Geheimnisschlüssels (Hex) – erlaubt den Vergleich, ohne den Schlüssel preiszugeben. */
export const secretKeyCheck = (secretKeyHex: string): string => createHmac("sha256", Buffer.from(secretKeyHex, "hex")).update("schrauberos:secret-key-check:v1").digest("hex");
