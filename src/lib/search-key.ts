// Normalisierte Suchspalten (P2b-1): Kunden, Fahrzeuge und Rechnungspartner pflegen beim Schreiben eine gefaltete Zeichenfolge, in der die Suche per `contains()` sucht.
// SQLite unterscheidet bei LIKE nur ASCII-Buchstaben nicht nach Groß-/Kleinschreibung („MÜLLER“ fände „Müller“ nicht), kennt keine Umlaut-Gleichheit und
// keine Trenner („B-AB 1234“ ≠ „BAB1234“, „0171/123456“ ≠ „0171 123456“). Alles Rechnen ist rein (ohne Datenbank) und wird in den Operationen aufgerufen.

const TRENNER = " | ";

/** Umlaute als Zwei-Buchstaben-Schreibung („Müller“ → „mueller“), `ß` → „ss“. */
const DIGRAPH: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
/** Umlaute ohne Punkte („Müller“ → „muller“), wie sie jemand ohne deutsche Tastatur tippt. */
const PLAIN: Record<string, string> = { ä: "a", ö: "o", ü: "u", ß: "ss" };

function fold(text: string, umlauts: Record<string, string>): string {
  const lower = text.normalize("NFC").toLowerCase().replace(/[äöüß]/g, (c) => umlauts[c]);
  // übrige Akzente („é“, „ñ“, „ç“) fallen weg; alles, was kein Buchstabe oder keine Ziffer ist (Leerzeichen, Bindestrich, Punkt, Komma, Schrägstrich), ist ein Trenner
  return lower
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Suchzeichenfolge aus beliebigen Textteilen: gefaltet (klein, ohne Akzente, Trenner als Leerzeichen) in der Umlaut-Schreibung „ae/oe/ue“, danach – nur wenn sie sich
 * unterscheidet – dieselben Teile in der Schreibung „a/o/u“. So findet „Müller“ sowohl „mueller“ als auch „muller“ (und „MÜLLER“).
 */
export function searchKey(...parts: Array<string | null | undefined>): string {
  const text = parts.filter((p): p is string => !!p).join(" ");
  const digraph = fold(text, DIGRAPH);
  const plain = fold(text, PLAIN);
  return plain === digraph ? digraph : `${digraph}${TRENNER}${plain}`;
}

/** Die Wörter eines Suchtextes, gefaltet wie die Spalte (Umlaut-Schreibung „ae/oe/ue“). Jedes Wort muss in der Spalte vorkommen, die Reihenfolge ist egal. */
export function searchTerms(term: string): string[] {
  const folded = fold(term, DIGRAPH);
  return folded ? folded.split(" ") : [];
}

/**
 * Telefonnummer ohne Trenner: nur Ziffern; die Landesvorwahl +49/0049/+43/+41 wird zur führenden 0 („+49 171 123456“ und „0171/123456“ → „0171123456“).
 * Das Ergebnis ist leer, wenn keine Ziffern da sind.
 */
export function phoneKey(phone: string | null | undefined): string {
  if (!phone) return "";
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  const country = /^\+(49|43|41)\(?0?\)?/.exec(digits);
  if (country) digits = `0${digits.slice(country[0].length)}`;
  return digits.replace(/\D/g, "");
}

/** Mindestanzahl Ziffern, ab der ein Suchtext als Telefonnummer gilt (kürzere Ziffernfolgen träfen fast jede Nummer). */
export const PHONE_MIN_DIGITS = 3;

/** Suchtext als Telefonnummer, oder `null`, wenn er keine ist (enthält Buchstaben oder hat zu wenige Ziffern). */
export function phoneTerm(term: string): string | null {
  if (/\p{L}/u.test(term)) return null;
  const key = phoneKey(term);
  return key.length >= PHONE_MIN_DIGITS ? key : null;
}
