/**
 * Geometrie der Diagramme (`components/ui/chart.tsx`): reine Funktionen ohne DOM – Achsenteilung mit „runden“ Schritten, Balken- und Linienlage, Beschriftungen, die sich nicht überlappen.
 * Der Baustein zeichnet daraus ein Inline-SVG; getestet wird hier die Rechnung (`chart.test.ts`).
 */

export type ChartType = "bar" | "line";
export type ChartSeries = { id: string; label: string; values: ReadonlyArray<number | null> };

/** Höchstens so viele Farben sind unterscheidbar (Tokens `--chart-1…6`, die sechste ist neutral); weitere Reihen teilen sich die sechste und müssen beschriftet werden. */
export const CHART_COLORS = 6;
export const seriesColorIndex = (index: number): number => Math.min(index, CHART_COLORS - 1) + 1;

export type NiceScale = { min: number; max: number; step: number; ticks: number[] };

/** „Schöne“ Zahl (1, 2, 5 × 10ⁿ) nahe `value`; `round` rundet statt aufzurunden. */
function niceNumber(value: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let nice: number;
  if (round) nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/**
 * Achsenteilung für Werte von `min` bis `max` mit etwa `target` Teilstrichen. `includeZero` (Balken) zieht die Null immer in den Bereich. Gleiche Werte (oder keine) ergeben
 * einen sinnvollen Bereich, nie eine Teilung durch null. `integer` (Anzahlen): Die Teilstriche sind ganze Zahlen (Schritt mindestens 1) – keine „0,2 Fahrzeuge“.
 */
export function niceScale(min: number, max: number, target = 5, includeZero = true, integer = false): NiceScale {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 0;
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    hi = lo + 1;
    if (!includeZero) lo -= 1;
  }
  const rawStep = niceNumber(niceNumber(hi - lo, false) / Math.max(1, target - 1), true);
  const step = integer ? Math.max(1, Math.round(rawStep)) : rawStep;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let i = 0; start + i * step <= end + step / 1e6; i++) ticks.push(Number((start + i * step).toFixed(10)));
  return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks };
}

export type ChartLayoutInput = {
  type: ChartType;
  categories: readonly string[];
  series: readonly ChartSeries[];
  width?: number;
  height?: number;
  /** Breite eines Zeichens der Achsenbeschriftung in Einheiten des viewBox (Standard 6,4 für 11 px Schrift; bei 12 px etwa 7) */
  charWidth?: number;
  /** Beschriftung der Teilstriche – bestimmt den Platz links */
  formatTick?: (value: number) => string;
  /** Anzahlen: Teilstriche nur bei ganzen Zahlen */
  integer?: boolean;
};

export type ChartLayout = {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  scale: NiceScale;
  ticks: Array<{ value: number; y: number }>;
  zeroY: number;
  categories: Array<{ label: string; x: number; show: boolean }>;
  bars: Array<{ series: number; category: number; value: number; x: number; y: number; width: number; height: number }>;
  lines: Array<{ series: number; path: string; points: Array<{ category: number; x: number; y: number; value: number }> }>;
};

const CHAR_WIDTH = 6.4;

export function layoutChart(input: ChartLayoutInput): ChartLayout {
  const width = input.width ?? 640;
  const height = input.height ?? 240;
  const values = input.series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const scale = niceScale(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 0, 5, input.type === "bar", input.integer);
  const format = input.formatTick ?? ((v: number) => String(v));
  const charWidth = input.charWidth ?? CHAR_WIDTH;
  const tickWidth = Math.max(...scale.ticks.map((t) => format(t).length), 1) * charWidth;
  const plot = { left: Math.ceil(tickWidth) + 14, top: 14, right: width - 10, bottom: height - 28 };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const y = (value: number) => plot.bottom - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;
  const count = Math.max(1, input.categories.length);
  const slot = plotWidth / count;

  const labelWidth = Math.max(...input.categories.map((c) => c.length), 1) * charWidth + 8;
  const every = Math.max(1, Math.ceil(labelWidth / slot));
  const categories = input.categories.map((label, i) => ({ label, x: plot.left + slot * (i + 0.5), show: i % every === 0 }));

  const bars: ChartLayout["bars"] = [];
  const lines: ChartLayout["lines"] = [];
  const zeroY = y(0 < scale.min ? scale.min : 0 > scale.max ? scale.max : 0);
  if (input.type === "bar") {
    const group = slot * 0.78;
    const barWidth = Math.min(48, group / Math.max(1, input.series.length));
    const offset = (group - barWidth * input.series.length) / 2;
    input.series.forEach((s, si) => {
      s.values.forEach((value, ci) => {
        if (value === null || !Number.isFinite(value)) return;
        const top = y(value);
        const x = plot.left + slot * ci + (slot - group) / 2 + offset + barWidth * si;
        bars.push({ series: si, category: ci, value, x, y: Math.min(top, zeroY), width: barWidth, height: Math.abs(zeroY - top) });
      });
    });
  } else {
    input.series.forEach((s, si) => {
      const points: ChartLayout["lines"][number]["points"] = [];
      let path = "";
      let open = false;
      s.values.forEach((value, ci) => {
        if (value === null || !Number.isFinite(value)) {
          open = false; // Lücke: die Linie setzt neu an
          return;
        }
        const point = { category: ci, x: plot.left + slot * (ci + 0.5), y: y(value), value };
        points.push(point);
        path += `${open ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
        open = true;
      });
      lines.push({ series: si, path, points });
    });
  }
  return { width, height, plot, scale, ticks: scale.ticks.map((value) => ({ value, y: y(value) })), zeroY, categories, bars, lines };
}
