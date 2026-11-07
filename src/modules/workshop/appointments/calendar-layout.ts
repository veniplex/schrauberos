import { addDaysToKey, dayKey, isSameDay, minutesOfDay, startOfDay } from "@/lib/zone";

export type Positioned<T> = { item: T; lane: number; lanes: number };

/**
 * Verteilt zeitlich überlappende Termine auf nebeneinanderliegende Spuren (wie Outlook/Google).
 * Gibt je Termin die Spur und die Spurenzahl seiner Überlappungsgruppe zurück.
 */
export function assignLanes<T>(items: T[], range: (item: T) => [number, number]): Positioned<T>[] {
  const sorted = [...items].sort((a, b) => range(a)[0] - range(b)[0] || range(a)[1] - range(b)[1]);
  const result: Positioned<T>[] = [];
  let cluster: Positioned<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    cluster.forEach((p) => (p.lanes = lanes));
    result.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    const [start, end] = range(item);
    if (start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    clusterEnd = Math.max(clusterEnd, end);
    cluster.push({ item, lane, lanes: 1 });
  }
  flush();
  return result;
}

export { minutesOfDay };

/**
 * Beginn und Ende eines Termins in Minuten ab Mitternacht seines Starttages – für Lage und Spuren im Raster. Jeder Termin belegt **mindestens `minDuration`** (das
 * Raster für neue Termine, mindestens 15 Minuten): So ist jeder Block mindestens einen Rasterschritt hoch (bei Touch ≥ 44 px, siehe `--tap-row`) und zwei kurze
 * Termine hintereinander überdecken sich nie. Endet ein Termin erst am Folgetag, reicht er bis Mitternacht.
 */
export function eventSpan(startsAt: Date, endsAt: Date, minDuration: number): [start: number, end: number] {
  return eventSpanOnDay(startsAt, endsAt, startsAt, minDuration);
}

/** Überlappt der Termin diesen Kalendertag (Zone der Werkstatt)? Auch ein Termin, der gestern begonnen hat und heute endet, gehört zum Tag. */
export function overlapsDay(a: { startsAt: Date; endsAt: Date }, day: Date | string): boolean {
  const key = typeof day === "string" ? day : dayKey(day);
  return a.startsAt < startOfDay(addDaysToKey(key, 1)) && a.endsAt > startOfDay(key);
}

/**
 * Wie `eventSpan`, aber für einen bestimmten Tag: Ein Termin über Mitternacht reicht am Starttag bis 24:00 und beginnt am Folgetag bei 0:00 (Minuten der Wanduhr; am Tag der
 * Zeitumstellung ist der Tag in Stunden 23 oder 25 lang, das Raster rechnet aber mit der Wanduhr). Auch ein kurzer Rest am Folgetag ist mindestens einen Rasterschritt hoch.
 */
export function eventSpanOnDay(startsAt: Date, endsAt: Date, day: Date | string, minDuration: number): [start: number, end: number] {
  const key = typeof day === "string" ? day : dayKey(day);
  const dayStart = startOfDay(key);
  const nextStart = startOfDay(addDaysToKey(key, 1));
  const start = startsAt <= dayStart ? 0 : minutesOfDay(startsAt);
  const end = endsAt >= nextStart ? 24 * 60 : minutesOfDay(endsAt);
  return [start, Math.min(24 * 60, Math.max(end, start + Math.max(minDuration, 15)))];
}

/** Anteil der Terminfarbe an der Fläche eines Blocks (Rest: die Kartenfläche). Je mehr, desto kräftiger – aber nur so viel, dass auch gedämpfter Text (`ink-muted`) bei jeder gewählten Farbe lesbar bleibt (Test `calendar-contrast.test.ts`). */
export const EVENT_TINT_PERCENT = 12;

/** Fläche eines Termin-Blocks: Terminfarbe schwach in die Kartenfläche gemischt (Hell und Dunkel folgen `--surface`). */
export const eventSurface = (color: string) => `color-mix(in oklab, ${color} ${EVENT_TINT_PERCENT}%, var(--surface))`;

/** Wo die Tastatur in einem Raster aus Zeitfenstern (Spalten × Zeilen) landet; Pfeiltasten bewegen, Pos1/Ende springen in der Spalte, Bild auf/ab um `page` Zeilen. Null: Taste bewegt nichts. */
export function moveSlot(from: { col: number; row: number }, key: string, size: { cols: number; rows: number }, page = 4): { col: number; row: number } | null {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max - 1, 0));
  let { col, row } = from;
  switch (key) {
    case "ArrowDown":
      row += 1;
      break;
    case "ArrowUp":
      row -= 1;
      break;
    case "ArrowRight":
      col += 1;
      break;
    case "ArrowLeft":
      col -= 1;
      break;
    case "PageDown":
      row += page;
      break;
    case "PageUp":
      row -= page;
      break;
    case "Home":
      row = 0;
      break;
    case "End":
      row = size.rows - 1;
      break;
    default:
      return null;
  }
  const next = { col: clamp(col, size.cols), row: clamp(row, size.rows) };
  return next.col === from.col && next.row === from.row ? null : next;
}

/** Das Zeitfenster, das der Tab-Stopp des Rasters zuerst bekommt: das jetzige, wenn heute im Raster liegt, sonst das erste des ersten Tages. */
export function initialSlot(opts: { days: Date[]; now: Date; startMin: number; slotMinutes: number; rows: number }): { col: number; row: number } {
  const col = opts.days.findIndex((d) => isSameDay(d, opts.now));
  if (col < 0) return { col: 0, row: 0 };
  const row = Math.floor((minutesOfDay(opts.now) - opts.startMin) / opts.slotMinutes);
  return { col, row: Math.min(Math.max(row, 0), Math.max(opts.rows - 1, 0)) };
}
