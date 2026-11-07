/**
 * Die Zeitzone der Werkstatt – **explizit**, nicht die des Prozesses. Alles, was Tage, Uhrzeiten, Wochen und Monate der Werkstatt rechnet (Termine, Öffnungszeiten, Saison,
 * Abwesenheiten, Fälligkeiten, Rechnungsdaten, Backup-Uhrzeit, Cron-Jobs), geht durch diese Datei und rechnet in der Zone aus der Einstellung (`Workshop.timezone`); die
 * Umgebungsvariable `TZ` und die Ortszeit des Prozesses spielen dafür keine Rolle. (`applyTimezone` setzt `process.env.TZ` weiterhin mit – aus Gewohnheit für Bibliotheken und
 * Formatierung, die die Prozesszeit lesen; die Datumslogik hängt nicht daran. Tests laufen unter einer anderen `TZ` als der Werkstatt-Zone.)
 *
 * Die Funktionen heißen wie ihre Gegenstücke in `date-fns` (`startOfDay`, `addDays`, `isSameDay` …) und haben als letzten Parameter die Zone (Standard: Werkstatt-Zone) –
 * wer vorher `date-fns` benutzt hat, tauscht nur den Import. Ein **Kalendertag** ist der Text `JJJJ-MM-TT` (`dayKey`); als Zeitpunkt gespeichert wird er um 12:00 Uhr der
 * Werkstatt-Zone (`noon`), damit er in jeder Zone zum selben Tag gehört. Reine Funktionen ohne Datenbank und ohne Uhr (die aktuelle Zeit reicht der Aufrufer hinein).
 *
 * Sommerzeit: Eine Wandzeit, die es nicht gibt (02:30 am Tag der Umstellung auf Sommerzeit), gilt als der Zeitpunkt unmittelbar nach der Lücke; eine, die es zweimal gibt
 * (02:30 beim Zurückstellen), als der erste. `parseZoned` lehnt nicht existierende Wandzeiten ab (Eingaben), `instantOfWall` rechnet sie weiter (Berechnungen).
 */

const state = globalThis as unknown as { __workshopZone?: string };

/** Ist das ein IANA-Zonenname, den diese Laufzeit kennt? */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Die Zone des Prozesses – nur der Rückfall, solange keine Werkstatt-Zone gesetzt ist (Tests, erster Start vor der Einrichtung). */
const processZone = (): string => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Setzt die Werkstatt-Zone (beim Start aus der Datenbank, nach der Einrichtung und beim Speichern der Einstellungen). false bei unbekanntem Namen – dann bleibt die alte. */
export function setWorkshopZone(timeZone: string): boolean {
  if (!isValidTimeZone(timeZone)) return false;
  state.__workshopZone = timeZone;
  return true;
}

/** Vergisst die gesetzte Zone (nur für Tests). */
export function resetWorkshopZone(): void {
  delete state.__workshopZone;
}

/** Die Zone der Werkstatt. */
export function workshopZone(): string {
  return state.__workshopZone ?? processZone();
}

/* ───────────── Wandzeit ↔ Zeitpunkt ───────────── */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wandzeit in der Zeitzone als „UTC-Zeitstempel derselben Zahlen“ – die Differenz zum echten Zeitstempel ist der Versatz der Zone. */
function wallAsUtc(ts: number, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(ts))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

const offsetAt = (ts: number, timeZone: string) => wallAsUtc(ts, timeZone) - Math.floor(ts / 1000) * 1000;

/** Der Zeitpunkt einer Wandzeit (Zahlen als UTC übergeben): beim Zurückstellen der erste, in der Lücke der Zeitpunkt unmittelbar danach. */
export function instantOfWallTime(wallUtc: number, timeZone: string): number {
  const DAY = 86_400_000;
  const candidates = new Set<number>();
  for (const o of new Set([offsetAt(wallUtc - DAY, timeZone), offsetAt(wallUtc + DAY, timeZone)])) {
    const ts = wallUtc - o;
    if (offsetAt(ts, timeZone) === o) candidates.add(ts);
  }
  if (candidates.size > 0) return Math.min(...candidates);
  // Lücke der Umstellung auf Sommerzeit: mit dem Versatz davor ergibt sich der Zeitpunkt direkt nach der Lücke
  return wallUtc - offsetAt(wallUtc - DAY, timeZone);
}

export type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number; /** 0 = Sonntag … 6 = Samstag */ weekday: number };

/** Wandzeit eines Zeitpunkts in der Zone. */
export function wallOf(date: Date | number, timeZone: string = workshopZone()): Wall {
  const ts = typeof date === "number" ? date : date.getTime();
  const d = new Date(wallAsUtc(ts, timeZone));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), millisecond: ((ts % 1000) + 1000) % 1000, weekday: d.getUTCDay() };
}

/** Zeitpunkt der Wandzeit (Monat 1–12; Überläufe rollen wie bei `Date.UTC`). */
export function instantOf(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millisecond = 0, timeZone: string = workshopZone()): Date {
  return new Date(instantOfWallTime(Date.UTC(year, month - 1, day, hour, minute, second), timeZone) + millisecond);
}

/* ───────────── Kalendertage als Text (JJJJ-MM-TT) ───────────── */

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * `JJJJ-MM-TT` ist ein **echter Kalendertag**: kein Monat 13, kein 30. Februar, kein 29. Februar im Nichtschaltjahr, Jahr ab 1000.
 * (Die bloße Form „vier Ziffern, Bindestrich, zwei, zwei“ lässt `2026-02-30` durch; JavaScript rollt das still auf den 2. März – oder liefert „Invalid Date“.)
 */
export function isCalendarDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1000) return false;
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(year, month - 1, day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Kalendertag eines Zeitpunkts in der Zone als `JJJJ-MM-TT`. */
export function dayKey(date: Date | number, timeZone: string = workshopZone()): string {
  const w = wallOf(date, timeZone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Uhrzeit eines Zeitpunkts in der Zone als `HH:MM`. */
export function timeKey(date: Date | number, timeZone: string = workshopZone()): string {
  const w = wallOf(date, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** Monat eines Zeitpunkts in der Zone als `JJJJ-MM`. */
export function monthKeyOf(date: Date | number, timeZone: string = workshopZone()): string {
  const w = wallOf(date, timeZone);
  return `${pad(w.year, 4)}-${pad(w.month)}`;
}

const partsOfKey = (key: string): [number, number, number] => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Kein Kalendertag: ${key}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

/** Der Tag `n` Kalendertage später (negativ: früher) – reine Kalenderrechnung auf dem Text, ohne Zone und ohne Sommerzeit. */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = partsOfKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Wochentag eines Kalendertags: 0 = Sonntag … 6 = Samstag. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = partsOfKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Anzahl Kalendertage von `from` bis `to` (negativ, wenn `to` davor liegt). */
export function daysBetweenKeys(from: string, to: string): number {
  const [fy, fm, fd] = partsOfKey(from);
  const [ty, tm, td] = partsOfKey(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/* ───────────── Eingaben ───────────── */

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * „2026-11-05“ + „09:30“ → Zeitpunkt in der Zone. null bei ungültiger Eingabe **und bei einer Wandzeit, die es nicht gibt**: In der Lücke der Sommerzeitumstellung
 * (31.03.2030 02:30 in Europe/Berlin) läge ein Termin sonst zu einer Zeit, die niemand eingegeben hat. (Zeiten, die beim Zurückstellen doppelt vorkommen: die erste gilt.)
 */
export function parseZoned(day: string, time: string, timeZone: string = workshopZone()): Date | null {
  if (!isCalendarDay(day)) return null;
  const t = TIME_OF_DAY.exec(time);
  if (!t) return null;
  const [y, m, d] = partsOfKey(day);
  const at = instantOf(y, m, d, Number(t[1]), Number(t[2]), 0, 0, timeZone);
  const w = wallOf(at, timeZone);
  return w.year === y && w.month === m && w.day === d && w.hour === Number(t[1]) && w.minute === Number(t[2]) ? at : null;
}

/* ───────────── Rechnen in der Zone (Gegenstücke zu date-fns) ───────────── */

const keyOf = (value: Date | number | string, timeZone: string) => (typeof value === "string" ? value : dayKey(value, timeZone));

/** Beginn des Kalendertags (00:00 Uhr der Zone); als Text `JJJJ-MM-TT` übergeben oder als Zeitpunkt. */
export function startOfDay(value: Date | number | string, timeZone: string = workshopZone()): Date {
  const [y, m, d] = partsOfKey(keyOf(value, timeZone));
  return instantOf(y, m, d, 0, 0, 0, 0, timeZone);
}

/** Letzte Millisekunde des Kalendertags. */
export function endOfDay(value: Date | number | string, timeZone: string = workshopZone()): Date {
  return new Date(startOfDay(addDaysToKey(keyOf(value, timeZone), 1), timeZone).getTime() - 1);
}

/** 12:00 Uhr des Kalendertags in der Zone – so werden **Kalendertage** (Rechnungsdatum, Fälligkeit, Abwesenheit …) gespeichert, damit sie in jeder Zone derselbe Tag bleiben. */
export function noon(day: string, timeZone: string = workshopZone()): Date {
  const [y, m, d] = partsOfKey(day);
  return instantOf(y, m, d, 12, 0, 0, 0, timeZone);
}

/** Dieselbe Wandzeit `n` Kalendertage später (über die Sommerzeitumstellung hinweg bleibt die Uhrzeit). */
export function addDays(date: Date | number, n: number, timeZone: string = workshopZone()): Date {
  const w = wallOf(date, timeZone);
  const [y, m, d] = partsOfKey(addDaysToKey(`${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`, n));
  return instantOf(y, m, d, w.hour, w.minute, w.second, w.millisecond, timeZone);
}

/** Dieselbe Wandzeit `n` Monate später; ein Tag, den der Zielmonat nicht hat, rückt auf dessen letzten Tag (wie `date-fns`). */
export function addMonths(date: Date | number, n: number, timeZone: string = workshopZone()): Date {
  const w = wallOf(date, timeZone);
  const index = w.year * 12 + (w.month - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return instantOf(year, month, Math.min(w.day, last), w.hour, w.minute, w.second, w.millisecond, timeZone);
}

export function isSameDay(a: Date | number, b: Date | number, timeZone: string = workshopZone()): boolean {
  return dayKey(a, timeZone) === dayKey(b, timeZone);
}

/** Beginn der Woche (Standard Montag) um 00:00 Uhr der Zone. */
export function startOfWeek(value: Date | number | string, options: { weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 } = {}, timeZone: string = workshopZone()): Date {
  const key = keyOf(value, timeZone);
  const back = (weekdayOfKey(key) - (options.weekStartsOn ?? 0) + 7) % 7;
  return startOfDay(addDaysToKey(key, -back), timeZone);
}

export function startOfMonth(value: Date | number | string, timeZone: string = workshopZone()): Date {
  const [y, m] = partsOfKey(keyOf(value, timeZone));
  return instantOf(y, m, 1, 0, 0, 0, 0, timeZone);
}

/** Letzte Millisekunde des Monats. */
export function endOfMonth(value: Date | number | string, timeZone: string = workshopZone()): Date {
  const [y, m] = partsOfKey(keyOf(value, timeZone));
  return new Date(instantOf(y, m + 1, 1, 0, 0, 0, 0, timeZone).getTime() - 1);
}

/** Beginn jedes Kalendertags von `start` bis `end` (beide einschließlich). */
export function eachDayOfInterval(interval: { start: Date | number; end: Date | number }, timeZone: string = workshopZone()): Date[] {
  const from = dayKey(interval.start, timeZone);
  const count = daysBetweenKeys(from, dayKey(interval.end, timeZone));
  return Array.from({ length: Math.max(count + 1, 0) }, (_, i) => startOfDay(addDaysToKey(from, i), timeZone));
}

/** Kalendertage zwischen zwei Zeitpunkten (nach Datum in der Zone, nicht nach 24-Stunden-Blöcken). */
export function differenceInCalendarDays(later: Date | number, earlier: Date | number, timeZone: string = workshopZone()): number {
  return daysBetweenKeys(dayKey(earlier, timeZone), dayKey(later, timeZone));
}

/** Wochentag in der Zone: 0 = Sonntag … 6 = Samstag. */
export const getDay = (date: Date | number, timeZone: string = workshopZone()): number => wallOf(date, timeZone).weekday;
export const getHours = (date: Date | number, timeZone: string = workshopZone()): number => wallOf(date, timeZone).hour;
export const getMinutes = (date: Date | number, timeZone: string = workshopZone()): number => wallOf(date, timeZone).minute;
/** Minuten seit 00:00 Uhr der Zone. */
export const minutesOfDay = (date: Date | number, timeZone: string = workshopZone()): number => {
  const w = wallOf(date, timeZone);
  return w.hour * 60 + w.minute;
};
/** Tag des Monats (1–31) in der Zone. */
export const getDate = (date: Date | number, timeZone: string = workshopZone()): number => wallOf(date, timeZone).day;
export const getMonth = (date: Date | number, timeZone: string = workshopZone()): number => wallOf(date, timeZone).month - 1;
export const getFullYear = (date: Date | number, timeZone: string = workshopZone()): number => wallOf(date, timeZone).year;

/** ISO-Kalenderwoche (Woche mit dem ersten Donnerstag des Jahres ist Woche 1) des Tages in der Zone. */
export function getISOWeek(date: Date | number, timeZone: string = workshopZone()): number {
  const key = dayKey(date, timeZone);
  // Donnerstag derselben ISO-Woche bestimmt das Jahr
  const thursday = addDaysToKey(key, 4 - (weekdayOfKey(key) || 7));
  const [year] = partsOfKey(thursday);
  return Math.floor(daysBetweenKeys(`${pad(year, 4)}-01-01`, thursday) / 7) + 1;
}
