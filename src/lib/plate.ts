// Kennzeichen-Hilfen (von Fahrzeugen und Firmenfahrzeugen gemeinsam genutzt).

/**
 * "b-ab 1234" -> "BAB1234" – für Suche und Duplikaterkennung (Deutschland, Österreich, Schweiz).
 *  - Nur Buchstaben A–Z, Ziffern und die Umlaute Ä Ö Ü bleiben; Trenner (Leerzeichen, Bindestrich, Punkt, Mittelpunkt …) fallen weg. Umlaute bleiben Umlaute („MÜ“ ≠ „MUE“).
 *  - Unicode wird zusammengesetzt (NFC): „Ü“ von einem Mac (U + kombinierendes Trema) gleicht dem normalen „Ü“ – sonst wären gleiche Kennzeichen verschieden.
 *  - „ß“ gibt es auf Kennzeichen nicht; die Großschreibung macht daraus „SS“ (immer gleich, keine Sonderregel).
 */
export function normalizePlate(plate: string): string {
  return plate.normalize("NFC").toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
}

/** Anzeigeform: Großbuchstaben, getrimmt, mehrfache Leerzeichen zusammengefasst. */
export function formatPlate(plate: string): string {
  return plate.toUpperCase().trim().replace(/\s+/g, " ");
}
