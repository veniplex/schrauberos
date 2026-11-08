/**
 * Gemeinsame Regeln aller AES-256-GCM-Formate der Anwendung (`v1`-Geheimnisse, `b1`-gebundene Schlüssel, `p1`-Tresorblöcke, `w1`-Hülle des Wiederherstellungsschlüssels): **12-Byte-IV, 16-Byte-Tag**, beides beim
 * Verschlüsseln erzeugt und beim Öffnen **festgenagelt** (`authTagLength: 16`) – sonst nähme `setAuthTag` auch verkürzte Tags (4 bis 15 Byte) an, und das Format verspräche 128 Bit, hielte aber nur 32. Die
 * Teile stehen **kanonisch** in Base64 (kein Leerraum, kein URL-sicheres Alphabet, richtige Auffüllung, keine losen Restbits): was das Programm nicht so geschrieben hat, ist beschädigt. Reine Funktionen.
 */
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Kanonisches Base64 → Bytes; `null` bei jeder Abweichung (oder wenn `expectedBytes` nicht stimmt). Der leere Text ist ein gültiger leerer Wert. */
export function strictBase64(value: string, expectedBytes?: number): Buffer | null {
  if (!BASE64.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) return null;
  return expectedBytes === undefined || bytes.length === expectedBytes ? bytes : null;
}

/** IV und Tag aus ihrer Textform; `null`, wenn eines nicht kanonisch ist oder nicht die feste Länge hat. */
export function gcmParts(iv: string, tag: string): { iv: Buffer; tag: Buffer } | null {
  const ivBytes = strictBase64(iv, GCM_IV_BYTES);
  const tagBytes = strictBase64(tag, GCM_TAG_BYTES);
  return ivBytes && tagBytes ? { iv: ivBytes, tag: tagBytes } : null;
}
