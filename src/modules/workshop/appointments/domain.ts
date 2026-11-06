import { parseLocalDateTime } from "@/lib/dates";

/**
 * Reine Terminlogik (ohne Datenbank, deshalb gezielt testbar): Zeitfenster aus Formularwerten und Doppelbelegung eines Arbeitsplatzes.
 */

/** Stati, in denen ein Termin den Arbeitsplatz nicht mehr belegt. */
export const BAY_FREE_STATUSES: readonly string[] = ["cancelled", "no_show"];

/** Belegt ein Termin mit diesem Status seinen Arbeitsplatz? */
export const occupiesBay = (status: string): boolean => !BAY_FREE_STATUSES.includes(status);

export type Interval = { startsAt: Date; endsAt: Date };

/** Überlappen sich zwei Zeitfenster? Halboffen: Ein Termin, der genau dann endet, wenn der nächste beginnt, kollidiert nicht. */
export const intervalsOverlap = (a: Interval, b: Interval): boolean => a.startsAt < b.endsAt && a.endsAt > b.startsAt;

/** Beginn und Ende aus Datum (`JJJJ-MM-TT`), Uhrzeit (`HH:MM`) und Dauer in Minuten; null bei ungültigem Datum/ungültiger Zeit oder Dauer. */
export function appointmentWindow(date: string, time: string, durationMinutes: number): Interval | null {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1) return null;
  const startsAt = parseLocalDateTime(date, time);
  if (!startsAt) return null;
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000) };
}

export type BayBooking = Interval & { id: string; bayId: string | null; status: string };

/**
 * Der erste bestehende Termin, mit dem `candidate` den Arbeitsplatz doppelt belegen würde (sonst null). Ohne Arbeitsplatz oder mit einem
 * freigebenden Status (abgesagt, nicht erschienen) gibt es keine Kollision; der Termin selbst (`candidate.id`) zählt nicht, ebenso
 * wenig bestehende Termine mit freigebendem Status oder anderem Arbeitsplatz. Mehrere Treffer: der früheste.
 */
export function findBayClash<T extends BayBooking>(candidate: Omit<BayBooking, "id"> & { id?: string }, existing: readonly T[]): T | null {
  if (!candidate.bayId || !occupiesBay(candidate.status)) return null;
  let found: T | null = null;
  for (const other of existing) {
    if (other.id === candidate.id || other.bayId !== candidate.bayId || !occupiesBay(other.status)) continue;
    if (!intervalsOverlap(candidate, other)) continue;
    if (!found || other.startsAt < found.startsAt) found = other;
  }
  return found;
}
