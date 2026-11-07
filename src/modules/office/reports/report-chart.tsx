"use client";

import { Chart } from "@/components/ui/chart";
import { INTL_LOCALE } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { formatCents } from "@/lib/money";

/**
 * Diagramm eines Berichts: dünne Hülle um den Baustein `Chart` (Balken, Tokenfarben, „Als Tabelle“). Sie gibt es, weil die Zahlenformate (Cent als Euro, Prozent, Anzahl) in der **Sprache der Oberfläche**
 * gesetzt werden und eine Funktion als Eigenschaft nicht vom Server in den Browser gereicht werden kann – der Bericht sagt nur die Art (`kind`) und liefert reine Zahlen.
 */
export function ReportChart({ kind, title, categories, values, seriesLabel, categoryLabel }: { kind: "money" | "percent" | "count"; title: string; categories: readonly string[]; values: ReadonlyArray<number | null>; seriesLabel: string; categoryLabel?: string }) {
  const { locale, number } = useI18n();
  const format = kind === "money" ? (value: number) => formatCents(Math.round(value), INTL_LOCALE[locale]) : kind === "percent" ? (value: number) => `${number(value, { maximumFractionDigits: 1 })} %` : (value: number) => number(value);
  return <Chart type="bar" title={title} categories={categories} series={[{ id: "main", label: seriesLabel, values }]} formatValue={format} categoryLabel={categoryLabel} integer={kind === "count"} />;
}
