/**
 * Prüfungen für das Werkstattprofil (P4b-7): IBAN (Länge und Prüfsumme mod 97), BIC, USt-IdNr. (Format je Land) und Steuernummer (nachsichtig). Rein, ohne Datenbank.
 * Gespeichert werden normalisierte Werte (IBAN ohne Leerzeichen in Großbuchstaben); angezeigt wird die IBAN in Vierergruppen (`formatIban`).
 */

/** Leerraum entfernen, Großbuchstaben. */
export const normalizeIban = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

/** Feste Längen der IBAN für die Länder, in denen die Anwendung eingesetzt wird; andere Länder prüfen nur Form und Prüfsumme. */
const IBAN_LENGTH: Readonly<Record<string, number>> = { DE: 22, AT: 20, CH: 21, LI: 21 };

/** Prüfsumme nach ISO 7064 (mod 97-10): Die ersten vier Zeichen ans Ende, Buchstaben zu Zahlen (A = 10 … Z = 35), der Rest muss 1 sein. */
function mod97(rearranged: string): number {
  let remainder = 0;
  for (const char of rearranged) {
    const code = char >= "A" && char <= "Z" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/** Ist das eine gültige IBAN (nach `normalizeIban`)? */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const length = IBAN_LENGTH[iban.slice(0, 2)];
  if (length !== undefined && iban.length !== length) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

/** IBAN in Vierergruppen („DE89 3704 0044 0532 0130 00“). */
export const formatIban = (iban: string): string => normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();

/** BIC: 8 oder 11 Zeichen (Bank, Land, Ort, optional Filiale). */
export const normalizeBic = (value: string): string => value.replace(/\s+/g, "").toUpperCase();
export const isValidBic = (value: string): boolean => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(value));

/* ───────────── USt-IdNr. ───────────── */

/** Länderkennungen der EU für die nachsichtige Prüfung anderer Länder (`EL` für Griechenland, `XI` für Nordirland). */
const EU_VAT_PREFIXES = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"]);

/**
 * Umsatzsteuer-Identifikationsnummer ohne Leerzeichen, Punkte und Bindestriche in Großbuchstaben. Die Schweizer UID (`CHE-123.456.789 MWST`) behält ihre Ziffern
 * und den Zusatz (`CHE123456789MWST`).
 */
export const normalizeVatId = (value: string): string => value.replace(/[\s.\-]+/g, "").toUpperCase();

/**
 * Gültiges Format: Deutschland `DE` + 9 Ziffern, Österreich `ATU` + 8 Ziffern, Schweiz `CHE` + 9 Ziffern (+ `MWST`, `TVA` oder `IVA`); andere EU-Länder nachsichtig
 * (Kennung + 2 bis 12 Zeichen). Eine Prüfziffer wird nicht gerechnet – das Bundeszentralamt für Steuern bestätigt die Nummer, nicht diese Anwendung.
 */
export function isValidVatId(value: string): boolean {
  const id = normalizeVatId(value);
  if (id.startsWith("DE")) return /^DE\d{9}$/.test(id);
  if (id.startsWith("AT")) return /^ATU\d{8}$/.test(id);
  if (id.startsWith("CH")) return /^CHE\d{9}(MWST|TVA|IVA)?$/.test(id);
  return EU_VAT_PREFIXES.has(id.slice(0, 2)) && /^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(id);
}

/** Schreibweise zur Anzeige: DE/AT unverändert, Schweiz als `CHE-123.456.789 MWST`. */
export function formatVatId(value: string): string {
  const id = normalizeVatId(value);
  const ch = /^CHE(\d{3})(\d{3})(\d{3})(MWST|TVA|IVA)?$/.exec(id);
  return ch ? `CHE-${ch[1]}.${ch[2]}.${ch[3]}${ch[4] ? ` ${ch[4]}` : ""}` : id;
}

/* ───────────── Steuernummer ───────────── */

/**
 * Steuernummer (die des Finanzamts, nicht die USt-IdNr.): Die Formen sind je Bundesland und Land verschieden (`21/815/08150`, `181/815/08155`, 13-stellig, österreichisch
 * `12-345/6789`), deshalb nachsichtig: nur Ziffern, Leerzeichen, `/`, `-`, `.`, mindestens 6 Ziffern, höchstens 20 Zeichen.
 */
export function isValidTaxNumber(value: string): boolean {
  const text = value.trim();
  return text.length <= 20 && /^[0-9][0-9 /.\-]*$/.test(text) && text.replace(/\D/g, "").length >= 6;
}
