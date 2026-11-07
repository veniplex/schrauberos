"use client";

import clsx from "clsx";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { layoutChart, seriesColorIndex, type ChartSeries, type ChartType } from "@/lib/chart";
import { Button } from "./buttons";
import { Table } from "./layout";

/**
 * Diagramm als Inline-SVG (Balken und Linien) ohne Bibliothek: schlank, mit der CSP verträglich, im Dunkeln richtig (die Farben sind die Tokens `--chart-1…6`, die für Hell und Dunkel
 * und für Farbfehlsichtigkeit geprüft sind, `tokens.test.ts`).
 *
 *  - **Ohne Hover:** Die Werte stehen bei wenigen Balken direkt am Balken; jede Marke trägt zusätzlich einen `<title>` (Tooltip am Rechner), nötig ist er nicht.
 *  - **Tabellen-Alternative:** „Als Tabelle“ zeigt dieselben Werte als Tabelle (für Screenreader der Weg zu den Zahlen, am Handy oft die bessere Ansicht); die Grafik hat einen zugänglichen Namen
 *    und eine Beschreibung (Art, Zahl der Reihen).
 *  - **Nicht nur Farbe:** Linien tragen je Reihe eine eigene Markenform (Kreis, Quadrat, Raute, Dreieck …); die Legende nennt Reihe und Farbe, und ab mehr als sechs Reihen teilen sich die
 *    weiteren die neutrale sechste Farbe (dann tragen nur die Marken und die Legende die Unterscheidung).
 *  - Zahlen formatiert `formatValue` (Cent als Euro, Prozent …); Standard ist die Zahl der Sprache.
 *
 * Geometrie und Teilung: `lib/chart.ts`. Das SVG skaliert mit der Breite (`viewBox`), die Schrift bleibt dabei lesbar, weil die Breite 640 nur etwa das 1,7-fache einer Handybreite ist.
 */

const FILL: Record<number, string> = { 1: "fill-chart-1", 2: "fill-chart-2", 3: "fill-chart-3", 4: "fill-chart-4", 5: "fill-chart-5", 6: "fill-chart-6" };
const STROKE: Record<number, string> = { 1: "stroke-chart-1", 2: "stroke-chart-2", 3: "stroke-chart-3", 4: "stroke-chart-4", 5: "stroke-chart-5", 6: "stroke-chart-6" };
const BG: Record<number, string> = { 1: "bg-chart-1", 2: "bg-chart-2", 3: "bg-chart-3", 4: "bg-chart-4", 5: "bg-chart-5", 6: "bg-chart-6" };

const MARKS = ["circle", "square", "diamond", "triangle"] as const;

function Mark({ shape, x, y, size = 4.5, className, children }: { shape: (typeof MARKS)[number]; x: number; y: number; size?: number; className: string; children?: ReactNode }) {
  switch (shape) {
    case "circle":
      return (
        <circle cx={x} cy={y} r={size} className={className}>
          {children}
        </circle>
      );
    case "square":
      return (
        <rect x={x - size} y={y - size} width={size * 2} height={size * 2} className={className}>
          {children}
        </rect>
      );
    case "diamond":
      return (
        <polygon points={`${x},${y - size * 1.3} ${x + size * 1.3},${y} ${x},${y + size * 1.3} ${x - size * 1.3},${y}`} className={className}>
          {children}
        </polygon>
      );
    case "triangle":
      return (
        <polygon points={`${x},${y - size * 1.2} ${x + size * 1.2},${y + size} ${x - size * 1.2},${y + size}`} className={className}>
          {children}
        </polygon>
      );
  }
}

export function Chart({
  type,
  title,
  categories,
  series,
  formatValue,
  height = 240,
  categoryLabel,
  integer,
  className,
}: {
  type: ChartType;
  /** Name der Grafik (Überschrift der Tabelle und zugänglicher Name) */
  title: string;
  categories: readonly string[];
  series: readonly ChartSeries[];
  formatValue?: (value: number) => string;
  height?: number;
  /** Beschriftung der ersten Tabellenspalte (Standard „Zeitraum“) */
  categoryLabel?: string;
  /** Anzahlen: die Achse teilt nur bei ganzen Zahlen */
  integer?: boolean;
  className?: string;
}) {
  const { t, number } = useI18n();
  const id = useId();
  const [asTable, setAsTable] = useState(false);
  const format = formatValue ?? ((value: number) => number(value));
  const empty = categories.length === 0 || series.length === 0 || series.every((s) => s.values.every((v) => v === null));
  const layout = layoutChart({ type, categories, series, height, formatTick: format, integer });
  const showValues = type === "bar" && layout.bars.length <= 12;
  const description = t("ui.chart.summary", { type: t(type === "bar" ? "ui.chart.bar" : "ui.chart.line"), series: series.length, categories: categories.length });

  if (empty) return <p className={clsx("rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-muted", className)}>{t("ui.chart.noData")}</p>;

  return (
    <figure className={clsx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <Button size="sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? t("ui.chart.showChart") : t("ui.chart.showTable")}
        </Button>
      </div>

      {asTable ? (
        <Table caption={title}>
          <thead>
            <tr>
              <th scope="col">{categoryLabel ?? t("ui.chart.category")}</th>
              {series.map((s) => (
                <th key={s.id} scope="col" className="text-right">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category, ci) => (
              <tr key={`${category}-${ci}`}>
                <th scope="row" className="font-normal">
                  {category}
                </th>
                {series.map((s) => (
                  <td key={s.id} className="text-right tabular">
                    {s.values[ci] === null || s.values[ci] === undefined ? "–" : format(s.values[ci] as number)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="h-auto w-full overflow-visible">
          <title id={`${id}-t`}>{title}</title>
          <desc id={`${id}-d`}>{description}</desc>
          {layout.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={layout.plot.left} x2={layout.plot.right} y1={tick.y} y2={tick.y} className={tick.value === 0 ? "stroke-line-strong" : "stroke-line"} strokeWidth={1} />
              <text x={layout.plot.left - 6} y={tick.y} textAnchor="end" dominantBaseline="middle" fontSize={11} className="fill-ink-muted tabular">
                {format(tick.value)}
              </text>
            </g>
          ))}
          {layout.categories.map((c, i) =>
            c.show ? (
              <text key={`${c.label}-${i}`} x={c.x} y={layout.plot.bottom + 16} textAnchor="middle" fontSize={11} className="fill-ink-muted">
                {c.label}
              </text>
            ) : null,
          )}

          {type === "bar"
            ? layout.bars.map((bar) => {
                const color = seriesColorIndex(bar.series);
                const label = `${series[bar.series].label}, ${categories[bar.category]}: ${format(bar.value)}`;
                return (
                  <g key={`${bar.series}-${bar.category}`}>
                    <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(bar.height, 0.5)} rx={2} className={FILL[color]}>
                      <title>{label}</title>
                    </rect>
                    {showValues ? (
                      <text x={bar.x + bar.width / 2} y={bar.value >= 0 ? bar.y - 4 : bar.y + bar.height + 12} textAnchor="middle" fontSize={11} className="fill-ink tabular">
                        {format(bar.value)}
                      </text>
                    ) : null}
                  </g>
                );
              })
            : layout.lines.map((line) => {
                const color = seriesColorIndex(line.series);
                const shape = MARKS[line.series % MARKS.length];
                return (
                  <g key={series[line.series].id}>
                    <path d={line.path} fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className={STROKE[color]} />
                    {line.points.map((point) => (
                      <Mark key={point.category} shape={shape} x={point.x} y={point.y} className={clsx(FILL[color], "stroke-surface")}>
                        <title>{`${series[line.series].label}, ${categories[point.category]}: ${format(point.value)}`}</title>
                      </Mark>
                    ))}
                  </g>
                );
              })}
        </svg>
      )}

      {series.length > 1 ? (
        <ul aria-label={t("ui.chart.legend")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {series.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5">
              {type === "line" ? (
                <svg aria-hidden width={14} height={14} viewBox="0 0 14 14" className="shrink-0">
                  <Mark shape={MARKS[i % MARKS.length]} x={7} y={7} size={4} className={FILL[seriesColorIndex(i)]} />
                </svg>
              ) : (
                <span aria-hidden className={clsx("inline-block size-2.5 rounded-sm", BG[seriesColorIndex(i)])} />
              )}
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}
