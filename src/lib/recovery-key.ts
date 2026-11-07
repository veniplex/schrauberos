import { checkChar, RECOVERY_ALPHABET } from "./recovery-code";

/**
 * Wiederherstellungsschlüssel (Geheimnisse und Off-Site-Backup) – reine Formatlogik ohne Zufall, auch für die Eingabeprüfung im Browser nutzbar.
 *
 * 256 Bit (32 Bytes) in 52 Zeichen des Code-Alphabets (5 Bit je Zeichen, das letzte Zeichen trägt 1 Bit und 4 Nullbits), in 13 Gruppen zu je 4 Zeichen mit einem
 * Prüfzeichen je Gruppe: `ABCD7-EFGH2-…` (13 × 5 Zeichen = 65 mit Bindestrichen). Das Prüfzeichen entdeckt jeden einzelnen Tippfehler und sagt, *welche* Gruppe falsch ist.
 * Das Format unterscheidet sich vom Notzugangs-Code (8 Gruppen) – beide lassen sich nicht verwechseln.
 */
export const KEY_BYTES = 32;
export const KEY_GROUPS = 13;
export const KEY_GROUP_CHARS = 4;
export const KEY_DATA_CHARS = KEY_GROUPS * KEY_GROUP_CHARS;
const FORMATTED_CHARS = KEY_GROUPS * (KEY_GROUP_CHARS + 1);

const indexOf = (char: string) => RECOVERY_ALPHABET.indexOf(char);

/** 32 Bytes → 52 Zeichen im Code-Alphabet. */
export function keyBytesToChars(bytes: Uint8Array): string {
  if (bytes.length !== KEY_BYTES) throw new Error("Ein Wiederherstellungsschlüssel braucht genau 32 Zufallsbytes.");
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** 52 Zeichen → 32 Bytes; null, wenn die Füllbits nicht null sind (kein von uns erzeugter Schlüssel). */
export function keyCharsToBytes(chars: string): Buffer | null {
  if (chars.length !== KEY_DATA_CHARS) return null;
  const out = Buffer.alloc(KEY_BYTES);
  let bits = 0;
  let value = 0;
  let pos = 0;
  for (const char of chars) {
    const index = indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      if (pos >= KEY_BYTES) return null;
      out[pos++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return pos === KEY_BYTES && value === 0 ? out : null;
}

/** Anzeigeform `ABCD7-EFGH2-…` aus 32 Bytes. */
export function formatRecoveryKey(bytes: Uint8Array): string {
  const data = keyBytesToChars(bytes);
  const groups: string[] = [];
  for (let g = 0; g < KEY_GROUPS; g++) {
    const part = data.slice(g * KEY_GROUP_CHARS, (g + 1) * KEY_GROUP_CHARS);
    groups.push(part + checkChar(part, g));
  }
  return groups.join("-");
}

export type ParsedRecoveryKey = { ok: true; key: Buffer } | { ok: false; reason: "length" | "chars" | "checksum"; badGroup?: number };

/** Liest eine Eingabe: normalisiert (Groß-/Kleinschreibung, Bindestriche, Leerzeichen egal; O = 0, I/L = 1), prüft Länge, Zeichen und Prüfzeichen. */
export function parseRecoveryKey(input: string): ParsedRecoveryKey {
  const cleaned = input.toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (cleaned.length !== FORMATTED_CHARS) return { ok: false, reason: "length" };
  if ([...cleaned].some((c) => indexOf(c) < 0)) return { ok: false, reason: "chars" };
  let data = "";
  for (let g = 0; g < KEY_GROUPS; g++) {
    const part = cleaned.slice(g * 5, g * 5 + 4);
    if (checkChar(part, g) !== cleaned[g * 5 + 4]) return { ok: false, reason: "checksum", badGroup: g + 1 };
    data += part;
  }
  const key = keyCharsToBytes(data);
  return key ? { ok: true, key } : { ok: false, reason: "chars" };
}
