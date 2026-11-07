import { phoneKey, searchKey } from "@/lib/search-key";

/** Anzeigename eines Kunden; ohne Kunde (z. B. Fahrzeug ohne Halter) ein Gedankenstrich. */
export function customerDisplayName(
  c: { firstName?: string | null; lastName: string; company?: string | null } | null | undefined,
): string {
  if (!c) return "–";
  // Bei reinen Firmenkunden steht der Firmenname zusätzlich im Nachnamen (Sortierung/Suche)
  const person = [c.firstName, c.company && c.lastName === c.company ? "" : c.lastName].filter(Boolean).join(" ");
  return c.company ? `${c.company}${person ? ` (${person})` : ""}` : person;
}

/**
 * Die normalisierten Suchspalten eines Kunden (`nameKey`, `cityKey`, `phoneKey`; siehe `src/lib/search-key.ts`). Sie werden bei jedem Schreiben mit gepflegt
 * (`customerRecord`), damit die Suche Umlaute, Groß-/Kleinschreibung und Trenner in Namen und Telefonnummern verträgt.
 */
export function customerSearchKeys(c: { firstName?: string | null; lastName: string; company?: string | null; city?: string | null; phone?: string | null }) {
  return { nameKey: searchKey(c.firstName, c.lastName, c.company), cityKey: searchKey(c.city), phoneKey: phoneKey(c.phone) };
}

/** Womit ein Kunde noch verknüpft ist: Wer Fahrzeuge (auch früher gehalten), Rechnungen oder Aufträge hat, ist nicht löschbar. */
export type CustomerLinks = { vehicles: number; ownerships: number; invoices: number; /** Aufträge direkt am Kunden (ohne Halterfahrzeug) – Aufträge werden nie gelöscht */ orders: number };

/** Frühere Halterschaften: Halter-Einträge ohne die der Fahrzeuge, die der Kunde jetzt hält (jedes hat einen offenen Eintrag). */
export const formerOwnerships = (links: Pick<CustomerLinks, "vehicles" | "ownerships">): number => Math.max(links.ownerships - links.vehicles, 0);

export const customerHasLinks = (links: CustomerLinks): boolean => links.vehicles > 0 || links.ownerships > 0 || links.invoices > 0 || links.orders > 0;
