import "server-only";

/**
 * Teilstring-Suche (SQL LIKE). SQLite unterscheidet dabei bei ASCII-Buchstaben nicht zwischen Groß- und Kleinschreibung;
 * bei Umlauten schon („MÜLLER“ findet „Müller“ nicht, „müller“ schon). Zentral gekapselt, damit sich das an einer Stelle
 * verbessern lässt (z. B. über normalisierte Suchspalten).
 */
export function contains(value: string) {
  return { contains: value };
}
