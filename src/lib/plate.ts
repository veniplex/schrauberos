// Kennzeichen-Hilfen (von Fahrzeugen und Firmenfahrzeugen gemeinsam genutzt).

/** "b-ab 1234" -> "BAB1234" – für Suche und Duplikaterkennung. */
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
}

/** Anzeigeform: Großbuchstaben, getrimmt, mehrfache Leerzeichen zusammengefasst. */
export function formatPlate(plate: string): string {
  return plate.toUpperCase().trim().replace(/\s+/g, " ");
}
