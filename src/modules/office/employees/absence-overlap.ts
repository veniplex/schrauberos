import { dayKey, workshopZone } from "@/lib/zone";
import type { AbsenceType } from "./domain";

/**
 * Überschneidungswarnung beim Eintragen einer Abwesenheit (P2b-2). Rein: Aus dem geplanten Zeitraum (Kalendertage `JJJJ-MM-TT`) und den schon vorhandenen Abwesenheiten
 * **derselben Person** folgen die Hinweise. Eine Überschneidung ist nur ein Hinweis (Urlaub und Schulung am selben Tag kommen vor); blockiert wird allein die **exakte Dublette**
 * (dieselbe Art, derselbe Zeitraum).
 *
 * Krankheit bleibt maskiert: Ohne `employees.sensitive` liefert die Abfrage Krankheitszeilen als `masked` (ohne Art und Anmerkung); der Hinweis nennt dann nur den Zeitraum
 * („abwesend“), nie „krank“ – und eine maskierte Zeile ist nie eine Dublette (ihre Art ist unbekannt, und diese Person kann ohnehin keine Krankheit eintragen).
 */
export type PlannedAbsence = { type: AbsenceType; start: string; end: string };
export type ExistingAbsence = { type: AbsenceType | "masked"; startDate: Date; endDate: Date };
export type AbsenceHint = { start: string; end: string; type: AbsenceType | "masked" };
export type AbsenceHints = { duplicate: boolean; overlaps: AbsenceHint[] };

export function absenceHints(planned: PlannedAbsence, existing: readonly ExistingAbsence[], timeZone: string = workshopZone()): AbsenceHints {
  const overlaps: AbsenceHint[] = [];
  let duplicate = false;
  for (const row of existing) {
    const start = dayKey(row.startDate, timeZone);
    const end = dayKey(row.endDate, timeZone);
    if (start > planned.end || end < planned.start) continue;
    if (row.type === planned.type && start === planned.start && end === planned.end) duplicate = true;
    overlaps.push({ start, end, type: row.type });
  }
  overlaps.sort((a, b) => (a.start === b.start ? (a.end < b.end ? -1 : 1) : a.start < b.start ? -1 : 1));
  return { duplicate, overlaps };
}
