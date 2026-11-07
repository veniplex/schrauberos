import type { Holiday, HolidayLookup } from "@/lib/holidays";
import { addDaysToKey, dayKey, startOfDay, weekdayOfKey } from "@/lib/zone";
import { HINT_RULES, MAX_ENTRY_MINUTES } from "./constants";

/**
 * Reine Rechenkerne der Zeiterfassung (ohne Datenbank, in der Werkstatt-Zone): Dauer, Aufteilung auf Kalendertage, Pausen- und Ruhezeit-Hinweise, Wochenübersicht Ist/Soll/Saldo.
 * Alle Zeiten sind Zeitpunkte; Tage sind Kalendertage der Werkstatt-Zone (`JJJJ-MM-TT`, `lib/zone.ts`).
 */

export type Span = { startedAt: Date; endedAt: Date | null; breakMinutes: number };

const MINUTE = 60_000;
const minutesBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / MINUTE);

/** Dauer eines Eintrags in Minuten, abzüglich der erfassten Pause (nie negativ). Ein laufender Eintrag zählt bis `now`. */
export function entryMinutes(span: Span, now: Date): number {
  const end = span.endedAt ?? now;
  return Math.max(0, minutesBetween(span.startedAt, end < span.startedAt ? span.startedAt : end) - span.breakMinutes);
}

/** Stunden und Minuten als `7:30` (für die Anzeige; Vorzeichen bei negativen Werten). */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** Abrechnungsmenge in Tausendsteln einer Einheit: Stunden (60 Minuten) oder Arbeitswerte (`workUnitMinutes` Minuten je AW). */
export function billableQuantityMilli(minutes: number, unit: "h" | "aw", workUnitMinutes: number): number {
  const base = unit === "h" ? 60 : Math.max(1, workUnitMinutes);
  return Math.round((minutes * 1000) / base);
}

/** Preis je abgerechneter Einheit in Cent: der Stundensatz, bei Arbeitswerten der Satz für einen AW. */
export function billableUnitCents(hourlyRateCents: number, unit: "h" | "aw", workUnitMinutes: number): number {
  return unit === "h" ? hourlyRateCents : Math.round((hourlyRateCents * Math.max(1, workUnitMinutes)) / 60);
}

/* ───────────── Aufteilung auf Kalendertage ───────────── */

export type Segment = { day: string; start: Date; end: Date; minutes: number };

/** Teilt einen Eintrag an den Mitternächten der Werkstatt-Zone in Tagesstücke. Die erfasste Pause wird vom ersten Stück abgezogen und, reicht es nicht, vom nächsten (die Summe stimmt mit `entryMinutes` überein). Ein Eintrag ohne Ende zählt bis `now`. */
export function splitByDay(span: Span, now: Date, timeZone?: string): Segment[] {
  const end = span.endedAt ?? now;
  if (end <= span.startedAt) return [];
  const out: Segment[] = [];
  let cursor = span.startedAt;
  let pause = span.breakMinutes;
  while (cursor < end && out.length < 40) {
    const day = dayKey(cursor, timeZone);
    const boundary = startOfDay(addDaysToKey(day, 1), timeZone);
    const stop = boundary < end ? boundary : end;
    const raw = minutesBetween(cursor, stop);
    const taken = Math.min(raw, pause);
    pause -= taken;
    out.push({ day, start: cursor, end: stop, minutes: raw - taken });
    cursor = stop;
  }
  return out;
}

export type DaySummary = {
  day: string;
  /** Arbeitszeit in Minuten */
  worked: number;
  /** Pausen: erfasste Pausen plus Lücken zwischen den Einträgen des Tages */
  pause: number;
  /** erster Beginn und letztes Ende des Tages */
  firstStart: Date;
  lastEnd: Date;
};

/** Summiert Einträge je Kalendertag (Arbeitszeit, Pausen, erster Beginn, letztes Ende). Stornierte Einträge gehören nicht hierher (der Aufrufer filtert). */
export function summarizeDays(spans: readonly Span[], now: Date, timeZone?: string): Map<string, DaySummary> {
  const byDay = new Map<string, Segment[]>();
  const explicitBreaks = new Map<string, number>();
  for (const span of spans) {
    const segments = splitByDay(span, now, timeZone);
    for (const segment of segments) byDay.set(segment.day, [...(byDay.get(segment.day) ?? []), segment]);
    if (segments.length > 0) explicitBreaks.set(segments[0].day, (explicitBreaks.get(segments[0].day) ?? 0) + span.breakMinutes);
  }
  const out = new Map<string, DaySummary>();
  for (const [day, segments] of byDay) {
    const sorted = [...segments].sort((a, b) => a.start.getTime() - b.start.getTime());
    let gaps = 0;
    let reach = sorted[0].end;
    for (const segment of sorted.slice(1)) {
      if (segment.start > reach) gaps += minutesBetween(reach, segment.start);
      if (segment.end > reach) reach = segment.end;
    }
    out.set(day, { day, worked: sorted.reduce((sum, s) => sum + s.minutes, 0), pause: gaps + (explicitBreaks.get(day) ?? 0), firstStart: sorted[0].start, lastEnd: reach });
  }
  return out;
}

/* ───────────── Hinweise (Pausen, Ruhezeit, Höchstarbeitszeit) ───────────── */

export type TimeHint =
  | { kind: "break"; day: string; worked: number; pause: number; needed: number }
  | { kind: "maxDay"; day: string; worked: number }
  | { kind: "rest"; day: string; rest: number }
  | { kind: "forgotten"; day: string; minutes: number };

/**
 * Hinweise für die gegebenen Einträge (ruhige Liste, nie eine Sperre; Schwellen und Vorbehalt in `HINT_RULES`):
 *  - mehr als 6 Stunden Arbeit an einem Tag mit weniger als 30 Minuten Pause (ab 9 Stunden: 45 Minuten),
 *  - mehr als 10 Stunden Arbeit an einem Tag,
 *  - weniger als 11 Stunden Ruhezeit zwischen dem Ende eines Arbeitstags und dem Beginn des nächsten,
 *  - ein Eintrag, der länger als 16 Stunden läuft (vermutlich nicht beendet).
 * Ein heute noch laufender Tag meldet keine fehlende Pause (sie kann noch kommen).
 */
export function hintsFor(spans: readonly Span[], now: Date, timeZone?: string): TimeHint[] {
  const hints: TimeHint[] = [];
  const today = dayKey(now, timeZone);
  const days = summarizeDays(spans, now, timeZone);
  for (const day of [...days.keys()].sort()) {
    const summary = days.get(day)!;
    if (summary.worked > HINT_RULES.maxDay) hints.push({ kind: "maxDay", day, worked: summary.worked });
    const needed = summary.worked > HINT_RULES.longBreakAfter ? HINT_RULES.longBreakNeeded : summary.worked > HINT_RULES.breakAfter ? HINT_RULES.breakNeeded : 0;
    const stillRunning = day === today && spans.some((s) => s.endedAt === null);
    if (needed > 0 && summary.pause < needed && !stillRunning) hints.push({ kind: "break", day, worked: summary.worked, pause: summary.pause, needed });
  }
  const sorted = [...spans].filter((s) => (s.endedAt ?? now) > s.startedAt).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (let i = 1; i < sorted.length; i++) {
    const end = sorted[i - 1].endedAt ?? now;
    const gap = minutesBetween(end, sorted[i].startedAt);
    // verschiedene Arbeitstage: das Ende des einen und der Beginn des anderen liegen an unterschiedlichen Kalendertagen (nahtlos über Mitternacht ist keine Ruhezeit)
    if (gap > 0 && gap < HINT_RULES.rest && dayKey(new Date(end.getTime() - 1), timeZone) !== dayKey(sorted[i].startedAt, timeZone)) hints.push({ kind: "rest", day: dayKey(sorted[i].startedAt, timeZone), rest: gap });
  }
  for (const span of spans) {
    const minutes = minutesBetween(span.startedAt, span.endedAt ?? now);
    if (minutes > HINT_RULES.forgotten) hints.push({ kind: "forgotten", day: dayKey(span.startedAt, timeZone), minutes });
  }
  return hints.sort((a, b) => a.day.localeCompare(b.day));
}

/* ───────────── Woche: Ist, Soll, Saldo ───────────── */

export type WeekDay = {
  day: string;
  worked: number;
  /** Sollzeit in Minuten (0 an freien Tagen, Feiertagen und bei Abwesenheit) */
  target: number;
  absent: boolean;
  holiday: Holiday | null;
  /** Arbeitstag der Person (Teilzeit-Muster) */
  scheduled: boolean;
};

export type WeekSummary = { days: WeekDay[]; worked: number; target: number; balance: number };

/**
 * Wochenübersicht Ist/Soll/Saldo. Soll = `targetMinutes` an jedem Arbeitstag der Person (Arbeitstage-Muster der Mitarbeiterverwaltung), an einem Feiertag 0 (halber Feiertag: die Hälfte), bei
 * Abwesenheit 0 (die Abwesenheit gilt als erfüllt; ob Urlaub oder Krankheit, erfährt die Zeiterfassung nie). Saldo = Ist − Soll.
 */
export function weekSummary(options: {
  days: readonly string[];
  summaries: ReadonlyMap<string, DaySummary>;
  pattern: ReadonlySet<number>;
  targetMinutes: number;
  holidays?: HolidayLookup;
  absentDays: ReadonlySet<string>;
}): WeekSummary {
  const days: WeekDay[] = options.days.map((day) => {
    const scheduled = options.pattern.has(weekdayOfKey(day));
    const holiday = options.holidays?.on(day) ?? null;
    const absent = options.absentDays.has(day);
    let target = scheduled ? options.targetMinutes : 0;
    if (holiday) target = holiday.half ? Math.round(target / 2) : 0;
    if (absent) target = 0;
    return { day, worked: options.summaries.get(day)?.worked ?? 0, target, absent, holiday, scheduled };
  });
  const worked = days.reduce((sum, d) => sum + d.worked, 0);
  const target = days.reduce((sum, d) => sum + d.target, 0);
  return { days, worked, target, balance: worked - target };
}

/** Montag bis Sonntag der Woche, in der `day` liegt. */
export function weekDays(day: string): string[] {
  const monday = addDaysToKey(day, -((weekdayOfKey(day) + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
}

/** Ist eine Dauer für einen einzelnen Eintrag zulässig (0 < Dauer ≤ 24 Stunden)? */
export const plausibleDuration = (start: Date, end: Date): boolean => end > start && minutesBetween(start, end) <= MAX_ENTRY_MINUTES;
