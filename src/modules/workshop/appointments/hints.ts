import type { HolidayLookup } from "@/lib/holidays";
import { weekdayKey, type OpeningHours } from "@/lib/opening-hours";
import { addDaysToKey, dayKey, daysBetweenKeys, minutesOfDay, startOfDay, timeKey, workshopZone } from "@/lib/zone";
import { occupiesBay, type Interval } from "./domain";

/**
 * Hinweise im Terminformular (P4b-1) – **rein**: Aus dem Zeitfenster und dem, was die Abfrage gefunden hat, folgt eine ruhige Liste. Nichts davon blockiert das Speichern; hart bleibt allein die
 * Doppelbelegung des Arbeitsplatzes (`findBayClash`). Hinweise gibt es zu Feiertagen, Öffnungszeiten, Terminen über Mitternacht, Abwesenheit des Zuständigen, dessen anderen Terminen und
 * einem Fahrzeug, das schon einen Termin hat.
 *
 * **Abwesenheit nennt nie die Art** (Krankheit ist besonders schützenswert): Die Abfrage liefert nur „abwesend“ ja/nein, die Liste sagt „abwesend“ – auch für Personen mit `employees.sensitive`.
 */

export type HintBooking = Interval & { title: string; status: string };

export type AppointmentHint =
  | { kind: "holiday"; day: string; half: boolean; key: string | null; name: string | null }
  | { kind: "closed"; day: string }
  | { kind: "outsideHours"; day: string; from: string; to: string }
  | { kind: "crossesMidnight"; endDay: string; endTime: string }
  | { kind: "assigneeAbsent"; name: string }
  | { kind: "assigneeBusy"; name: string; title: string; from: string; to: string }
  | { kind: "vehicleBooked"; plate: string; title: string; day: string; from: string; to: string };

export type HintContext = {
  window: Interval;
  hours: OpeningHours;
  holidays: HolidayLookup;
  /** Zuständige Person samt Abwesenheit im Zeitraum und ihren anderen Terminen */
  assignee?: { name: string; absent: boolean; others: readonly HintBooking[] };
  /** Fahrzeug samt seinen anderen Terminen */
  vehicle?: { plate: string; others: readonly HintBooking[] };
  timeZone?: string;
};

/** Stati, in denen ein Termin noch „offen“ ist (für „hat schon einen Termin“): nicht erledigt, nicht abgesagt. */
const OPEN_STATUSES: readonly string[] = ["scheduled", "confirmed", "in_progress"];
const MAX_LISTED = 2;

/** Die Kalendertage, die das Fenster berührt (Ende ausgeschlossen: ein Termin bis genau 00:00 Uhr berührt den Folgetag nicht). */
export function touchedDays(window: Interval, timeZone: string = workshopZone()): string[] {
  const first = dayKey(window.startsAt, timeZone);
  const last = dayKey(new Date(Math.max(window.endsAt.getTime() - 1, window.startsAt.getTime())), timeZone);
  return Array.from({ length: daysBetweenKeys(first, last) + 1 }, (_, i) => addDaysToKey(first, i));
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const overlapsDays = (booking: Interval, days: readonly string[], timeZone: string): boolean => {
  const touched = new Set(days);
  return touchedDays(booking, timeZone).some((d) => touched.has(d));
};

export function buildAppointmentHints(ctx: HintContext): AppointmentHint[] {
  const timeZone = ctx.timeZone ?? workshopZone();
  const { window } = ctx;
  const days = touchedDays(window, timeZone);
  const hints: AppointmentHint[] = [];

  for (const day of days) {
    const holiday = ctx.holidays.on(day);
    if (holiday) hints.push({ kind: "holiday", day, half: holiday.half, key: holiday.custom ? null : holiday.key, name: holiday.name });
  }

  for (const day of days) {
    const open = ctx.hours[weekdayKey(startOfDay(day, timeZone), timeZone)];
    if (!open) {
      hints.push({ kind: "closed", day });
      continue;
    }
    // Der Teil des Termins an diesem Tag, in Minuten der Wanduhr (bis Mitternacht des Tages, wenn er weitergeht)
    const dayStart = startOfDay(day, timeZone);
    const nextStart = startOfDay(addDaysToKey(day, 1), timeZone);
    const from = minutesOfDay(window.startsAt > dayStart ? window.startsAt : dayStart, timeZone);
    const to = window.endsAt >= nextStart ? 24 * 60 : minutesOfDay(window.endsAt, timeZone);
    if (from < toMinutes(open[0]) || to > toMinutes(open[1])) hints.push({ kind: "outsideHours", day, from: open[0], to: open[1] });
  }

  if (days.length > 1) hints.push({ kind: "crossesMidnight", endDay: dayKey(new Date(window.endsAt.getTime() - 1), timeZone), endTime: timeKey(window.endsAt, timeZone) });

  if (ctx.assignee) {
    if (ctx.assignee.absent) hints.push({ kind: "assigneeAbsent", name: ctx.assignee.name });
    for (const other of ctx.assignee.others.filter((o) => occupiesBay(o.status) && OPEN_STATUSES.includes(o.status)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, MAX_LISTED)) {
      if (other.startsAt < window.endsAt && other.endsAt > window.startsAt) hints.push({ kind: "assigneeBusy", name: ctx.assignee.name, title: other.title, from: timeKey(other.startsAt, timeZone), to: timeKey(other.endsAt, timeZone) });
    }
  }

  if (ctx.vehicle) {
    const others = ctx.vehicle.others.filter((o) => OPEN_STATUSES.includes(o.status) && overlapsDays(o, days, timeZone)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    for (const other of others.slice(0, MAX_LISTED)) hints.push({ kind: "vehicleBooked", plate: ctx.vehicle.plate, title: other.title, day: dayKey(other.startsAt, timeZone), from: timeKey(other.startsAt, timeZone), to: timeKey(other.endsAt, timeZone) });
  }
  return hints;
}
