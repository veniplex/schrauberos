import { createHash, randomBytes } from "node:crypto";

/**
 * Sicherungscodes der Zwei-Faktor-Anmeldung (für den Fall, dass das Telefon fehlt): je Konto 10 Einmalcodes zu 16 Zeichen (80 Bit Zufall) in vier Gruppen
 * (`ABCD-EFGH-JKMN-PQRS`). Gespeichert wird nur ein SHA-256-Hash, gebunden an das Konto – bei so viel Zufall genügt ein schneller Hash (Raten ist aussichtslos,
 * dazu drosselt die Anmeldung). **Nicht** zu verwechseln mit dem Wiederherstellungs-Code des Notzugangs (`recovery-code.ts`): Diese Codes ersetzen nur den zweiten
 * Faktor, nie das Passwort. Alphabet nach Crockford (ohne I, L, O, U); bei der Eingabe zählen O als 0 und I/L als 1, Groß-/Kleinschreibung und Trenner sind egal.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const BACKUP_CODE_COUNT = 10;
const CHARS = 16;

function randomCode(): string {
  // 32 Zeichen im Alphabet: jedes Byte liefert 5 Bit ohne Verzerrung (256 ist durch 32 teilbar)
  let raw = "";
  for (const byte of randomBytes(CHARS)) raw += ALPHABET[byte & 31];
  return raw;
}

const format = (raw: string) => raw.match(/.{4}/g)!.join("-");

/** Neue Codes in Anzeigeform (nur zur einmaligen Anzeige) – ohne doppelte. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(randomCode());
  return [...codes].map(format);
}

/** Eingabe lesen: 16 Zeichen des Alphabets, sonst null. Gibt die normalisierte Form ohne Trenner zurück. */
export function normalizeBackupCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return clean.length === CHARS && [...clean].every((c) => ALPHABET.includes(c)) ? clean : null;
}

/** Hash zum Speichern und Vergleichen; an das Konto gebunden. */
export const hashBackupCode = (userId: string, normalized: string): string => createHash("sha256").update(`schrauberos-2fa-backup-v1:${userId}:${normalized}`).digest("hex");

/** Eine Eingabe, die nie passt (für gleichförmige Prüfung ungültiger Eingaben). */
export const NEVER_MATCHING_BACKUP_CODE = "0".repeat(CHARS);
