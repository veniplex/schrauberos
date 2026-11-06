/** Anzeigename eines Kunden; ohne Kunde (z. B. Fahrzeug ohne Halter) ein Gedankenstrich. */
export function customerDisplayName(
  c: { firstName?: string | null; lastName: string; company?: string | null } | null | undefined,
): string {
  if (!c) return "–";
  // Bei reinen Firmenkunden steht der Firmenname zusätzlich im Nachnamen (Sortierung/Suche)
  const person = [c.firstName, c.company && c.lastName === c.company ? "" : c.lastName].filter(Boolean).join(" ");
  return c.company ? `${c.company}${person ? ` (${person})` : ""}` : person;
}
