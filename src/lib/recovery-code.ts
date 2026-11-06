/**
 * Wiederherstellungs-Code (Notzugang) – reine Formatlogik ohne Zufall und ohne Hash, auch für die Eingabeprüfung im Browser genutzt.
 *
 * Format: 32 Zeichen Nutzdaten (5 Bit je Zeichen = 160 Bit) in 8 Gruppen zu je 4 Zeichen, jede Gruppe mit einem Prüfzeichen
 * dahinter: `ABCD7-EFGH2-…` (8 × 5 Zeichen, mit Bindestrichen). Das Prüfzeichen entdeckt jeden einzelnen Tippfehler in der Gruppe
 * und die meisten Vertauschungen und sagt dem Menschen, *welche* Gruppe falsch ist. Alphabet nach Crockford (ohne I, L, O, U);
 * bei der Eingabe gelten O als 0 und I/L als 1, Groß-/Kleinschreibung, Bindestriche und Leerzeichen sind egal.
 */
export const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const GROUPS = 8;
export const GROUP_DATA_CHARS = 4;
export const DATA_CHARS = GROUPS * GROUP_DATA_CHARS;
/** Ungerade Gewichte sind modulo 32 umkehrbar: jede einzelne Änderung eines Zeichens ändert das Prüfzeichen. */
const WEIGHTS = [1, 3, 5, 7];

const indexOf = (char: string) => RECOVERY_ALPHABET.indexOf(char);

export function checkChar(group: string, groupIndex: number): string {
  let sum = groupIndex * 11 + 5;
  for (let i = 0; i < group.length; i++) sum += indexOf(group[i]) * WEIGHTS[i];
  return RECOVERY_ALPHABET[sum % 32];
}

/** 20 Bytes (160 Bit) → 32 Zeichen im Code-Alphabet. */
export function bytesToDataChars(bytes: Uint8Array): string {
  if (bytes.length !== 20) throw new Error("Ein Wiederherstellungs-Code braucht genau 20 Zufallsbytes.");
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
  return out;
}

/** Anzeigeform `ABCD7-EFGH2-…` aus den 32 Nutzdaten-Zeichen. */
export function formatRecoveryCode(dataChars: string): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    const part = dataChars.slice(g * GROUP_DATA_CHARS, (g + 1) * GROUP_DATA_CHARS);
    groups.push(part + checkChar(part, g));
  }
  return groups.join("-");
}

export type ParsedRecoveryCode = { ok: true; data: string } | { ok: false; reason: "length" | "chars" | "checksum"; badGroup?: number };

/** Liest eine Eingabe: normalisiert, prüft Länge, Zeichen und Prüfzeichen. Bei Erfolg die 32 Nutzdaten-Zeichen. */
export function parseRecoveryCode(input: string): ParsedRecoveryCode {
  const cleaned = input.toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (cleaned.length !== GROUPS * (GROUP_DATA_CHARS + 1)) return { ok: false, reason: "length" };
  if ([...cleaned].some((c) => indexOf(c) < 0)) return { ok: false, reason: "chars" };
  let data = "";
  for (let g = 0; g < GROUPS; g++) {
    const part = cleaned.slice(g * 5, g * 5 + 4);
    if (checkChar(part, g) !== cleaned[g * 5 + 4]) return { ok: false, reason: "checksum", badGroup: g + 1 };
    data += part;
  }
  return { ok: true, data };
}

/** Rückgabe der Aktionen, die einen neuen Code anzeigen (Einrichtung, Konto, Einlösen). Der Code steht nur in dieser Antwort. */
export type RecoveryActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  /** Klartext des neuen Codes – nur zur einmaligen Anzeige, wird nirgends gespeichert oder protokolliert */
  recoveryCode?: string;
  /** Ausstellungsdatum (bereits formatiert) für die Druckansicht */
  issuedOn?: string;
};
