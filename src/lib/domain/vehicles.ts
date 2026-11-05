/** "b-ab 1234" -> "BAB1234" – für Suche und Duplikaterkennung. */
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
}

/** Anzeigeform: Großbuchstaben, getrimmt, mehrfache Leerzeichen zusammengefasst. */
export function formatPlate(plate: string): string {
  return plate.toUpperCase().trim().replace(/\s+/g, " ");
}

export function customerDisplayName(c: {
  firstName?: string | null;
  lastName: string;
  company?: string | null;
}): string {
  // Bei reinen Firmenkunden steht der Firmenname zusätzlich im Nachnamen (Sortierung/Suche)
  const person = [c.firstName, c.company && c.lastName === c.company ? "" : c.lastName].filter(Boolean).join(" ");
  return c.company ? `${c.company}${person ? ` (${person})` : ""}` : person;
}
