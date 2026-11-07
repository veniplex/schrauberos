/**
 * Zeitpläne der Jobs (rein, ohne Datenbank und ohne Uhr – alles Zeitabhängige bekommt der Aufrufer hineingereicht):
 *  - `{ every: ms }`  Intervall: der nächste Lauf liegt `every` nach dem Ende des letzten (bzw. des Starts),
 *  - `{ cron: "m h dom mon dow" }` fünf Felder wie beim klassischen Cron (`*`, Zahl, `a-b`, `a,b`, Schrittweiten wie „Stern, Schrägstrich, n“ und `a-b` mit Schritt; Wochentag 0 oder 7 = Sonntag),
 *    ausgewertet in der **Zeitzone der Werkstatt** (IANA-Name, übergeben).
 *
 * Sommerzeit: Eine Uhrzeit, die es wegen der Umstellung nicht gibt (02:30 am Tag der Umstellung auf Sommerzeit), läuft unmittelbar nach der Lücke
 * (also um 03:30 neuer Zeit); eine Uhrzeit, die es zweimal gibt (02:30 beim Zurückstellen), läuft nur beim ersten Mal. Ein Tagesjob läuft damit
 * jeden Kalendertag genau einmal – auch an den Umstellungstagen.
 */

import { instantOfWallTime, wallOf } from "@/lib/zone";

export type Schedule = { every: number } | { cron: string };

type CronField = ReadonlySet<number>;
export type CronSpec = { minute: CronField; hour: CronField; dom: CronField; month: CronField; dow: CronField; domAny: boolean; dowAny: boolean };

function parseField(text: string, min: number, max: number, name: string): { values: Set<number>; any: boolean } {
  const values = new Set<number>();
  let any = false;
  for (const part of text.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`Cron: ungültiges Feld ${name}: "${text}"`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(`Cron: ungültige Schrittweite im Feld ${name}`);
    let from = min;
    let to = max;
    if (m[1] === "*") {
      if (m[2] === undefined) any = true;
    } else {
      const [a, b] = m[1].split("-").map(Number);
      from = a;
      to = b ?? (m[2] === undefined ? a : max);
    }
    if (from < min || to > max || from > to) throw new Error(`Cron: Wert außerhalb des Bereichs im Feld ${name}: "${text}"`);
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return { values, any };
}

/** Liest einen Cron-Ausdruck; wirft bei Fehlern (damit ein falscher Zeitplan beim Start auffällt, nicht erst nachts). */
export function parseCron(expression: string): CronSpec {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron: fünf Felder erwartet, erhalten: "${expression}"`);
  const minute = parseField(parts[0], 0, 59, "Minute");
  const hour = parseField(parts[1], 0, 23, "Stunde");
  const dom = parseField(parts[2], 1, 31, "Tag");
  const month = parseField(parts[3], 1, 12, "Monat");
  const dowRaw = parseField(parts[4], 0, 7, "Wochentag");
  const dow = new Set([...dowRaw.values].map((d) => d % 7));
  return { minute: minute.values, hour: hour.values, dom: dom.values, month: month.values, dow, domAny: dom.any, dowAny: dowRaw.any };
}

/** Prüft einen Zeitplan (wirft bei ungültigem Intervall oder Cron-Ausdruck). */
export function validateSchedule(schedule: Schedule): void {
  if ("every" in schedule) {
    if (!Number.isFinite(schedule.every) || schedule.every < 1000) throw new Error("Intervall: mindestens eine Sekunde");
  } else parseCron(schedule.cron);
}

/* ───────────── Zeitzonen (Rechnung in src/lib/zone.ts) ───────────── */

/** Wandzeit-Bestandteile eines Zeitpunkts in der Zone. */
function wallParts(ts: number, timeZone: string) {
  const w = wallOf(ts, timeZone);
  return { year: w.year, month: w.month, day: w.day };
}

/** Nächster Zeitpunkt strikt nach `after`, der zum Cron-Ausdruck passt (Wandzeit in `timeZone`). */
export function nextCronRun(spec: CronSpec, after: Date, timeZone: string): Date {
  const start = wallParts(after.getTime(), timeZone);
  const hours = [...spec.hour].sort((a, b) => a - b);
  const minutes = [...spec.minute].sort((a, b) => a - b);
  // höchstens ~8 Jahre vorwärts suchen (z. B. „29. Februar“); sonst ist der Ausdruck unerfüllbar
  for (let offset = 0; offset < 366 * 8; offset++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const month = day.getUTCMonth() + 1;
    const dom = day.getUTCDate();
    const dow = day.getUTCDay();
    if (!spec.month.has(month)) continue;
    // Tag des Monats und Wochentag: sind beide eingeschränkt, genügt einer (wie beim klassischen Cron)
    const domOk = spec.dom.has(dom);
    const dowOk = spec.dow.has(dow);
    if (!(spec.domAny || spec.dowAny ? domOk && dowOk : domOk || dowOk)) continue;
    let best: number | null = null;
    for (const h of hours) {
      for (const m of minutes) {
        const ts = instantOfWallTime(Date.UTC(day.getUTCFullYear(), month - 1, dom, h, m), timeZone);
        if (ts > after.getTime() && (best === null || ts < best)) best = ts;
      }
    }
    if (best !== null) return new Date(best);
  }
  throw new Error("Cron: kein Termin in den nächsten Jahren");
}

/** Nächster Lauf nach `after` (bei Intervallen: `after` + Intervall). */
export function nextRun(schedule: Schedule, after: Date, timeZone: string): Date {
  if ("every" in schedule) return new Date(after.getTime() + schedule.every);
  return nextCronRun(parseCron(schedule.cron), after, timeZone);
}

/** Wartezeit vor dem n-ten Wiederholungsversuch (n ab 1): Basis · 2^(n−1), nach oben begrenzt. */
export function backoffDelay(failures: number, baseMs: number, maxMs: number): number {
  const exponent = Math.min(Math.max(failures, 1) - 1, 30);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}
