"use client";

import { useState } from "react";
import { Button } from "@/components/ui/buttons";
import { Field, Input } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { presetPeriod, type PeriodPreset } from "./period";

const PRESETS: PeriodPreset[] = ["thisYear", "lastYear", "lastQuarter", "lastMonth"];

/**
 * Zeitraum für einen Export: Von und Bis (Datumsfelder, Namen `from`/`to`) und Voreinstellungen (dieses/letztes Jahr, letztes Quartal, letzter Monat) relativ zu `today`.
 * `required`: ohne Zeitraum lässt sich nicht absenden (Steuerberater-Export); sonst bedeutet leer „alles“.
 */
export function PeriodFields({ today, initial, required = false, idPrefix }: { today: string; initial?: { from: string; to: string }; required?: boolean; idPrefix: string }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState(initial ?? { from: "", to: "" });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("exchange.period.from")} htmlFor={`${idPrefix}-from`} required={required}>
          <Input id={`${idPrefix}-from`} name="from" type="date" value={period.from} required={required} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} />
        </Field>
        <Field label={t("exchange.period.to")} htmlFor={`${idPrefix}-to`} required={required}>
          <Input id={`${idPrefix}-to`} name="to" type="date" value={period.to} required={required} min={period.from || undefined} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} />
        </Field>
      </div>
      <div role="group" aria-labelledby={`${idPrefix}-presets`} className="flex flex-wrap items-center gap-2">
        <span id={`${idPrefix}-presets`} className="sr-only">
          {t("exchange.period.presets")}
        </span>
        {PRESETS.map((preset) => (
          <Button key={preset} size="sm" onClick={() => setPeriod(presetPeriod(preset, today))}>
            {t(`exchange.period.${preset}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
