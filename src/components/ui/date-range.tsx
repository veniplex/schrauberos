"use client";

import clsx from "clsx";
import { useId, useState } from "react";
import { useI18n } from "@/i18n/client";
import { presetRange, rangeDays, rangeState, RANGE_PRESETS, type RangePreset } from "@/lib/date-range";
import { Button } from "./buttons";
import { FieldError } from "./form-fields";
import { Input } from "./form-fields";

/**
 * Zeitraum aus zwei Tagen (Berichte, Zeiterfassung, Filter): „Von“ und „Bis“ als Datumsfelder (die Auswahl des Geräts: am Handy das Rad, am Rechner der Kalender) und eine Schnellauswahl
 * (heute, letzte 7/30 Tage, dieser/letzter Monat …). Beide Enden gehören zum Zeitraum. Ein Ende vor dem Beginn, ein unvollständiger oder zu langer Zeitraum steht als Meldung am Feld
 * (`aria-invalid`, `role="alert"`); das Datum kommt als `JJJJ-MM-TT` in den Feldern `from`/`to` (Namen änderbar), wie `dateText()` auf dem Server es liest.
 *
 * `today` kommt vom Server in der **Zeitzone der Werkstatt** (`todayInput()`) – der Baustein kennt keine Uhr (im Browser könnte die Zone eine andere sein). Ohne `today` entfällt die Schnellauswahl.
 */
export function DateRange({
  today,
  defaultFrom = "",
  defaultTo = "",
  nameFrom = "from",
  nameTo = "to",
  presets = ["today", "last7", "last30", "thisMonth", "lastMonth", "thisYear"],
  maxDays,
  required,
  onChange,
  className,
}: {
  today?: string;
  defaultFrom?: string;
  defaultTo?: string;
  nameFrom?: string;
  nameTo?: string;
  presets?: readonly RangePreset[];
  maxDays?: number;
  required?: boolean;
  onChange?: (range: { from: string; to: string }, valid: boolean) => void;
  className?: string;
}) {
  const { t, tp } = useI18n();
  const id = useId();
  const [range, setRange] = useState({ from: defaultFrom, to: defaultTo });
  const state = rangeState(range.from, range.to, { maxDays });
  const message = state === "reversed" ? t("ui.dateRange.reversed") : state === "invalid" ? t("ui.dateRange.invalid") : state === "tooLong" ? t("ui.dateRange.tooLong", { max: maxDays ?? 0 }) : state === "incomplete" ? t("ui.dateRange.incomplete") : null;
  // „unvollständig“ ist erst ein Fehler, wenn der Zeitraum Pflicht ist oder das andere Ende schon steht und man weitergeht – hier: sofort nur bei Pflicht
  const shown = state === "incomplete" && !required ? null : message;

  function set(next: { from: string; to: string }) {
    setRange(next);
    onChange?.(next, rangeState(next.from, next.to, { maxDays }) === "ok");
  }

  const errorId = `${id}-error`;
  return (
    <fieldset className={clsx("m-0 min-w-0 border-0 p-0", className)} aria-describedby={shown ? errorId : undefined}>
      <legend className="field-label p-0">{t("ui.dateRange.group")}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <label htmlFor={`${id}-from`} className="field-label">
            {t("ui.dateRange.from")}
          </label>
          <Input id={`${id}-from`} type="date" name={nameFrom} value={range.from} max={range.to || undefined} required={required} invalid={Boolean(shown)} aria-describedby={shown ? errorId : undefined} onChange={(event) => set({ ...range, from: event.target.value })} />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor={`${id}-to`} className="field-label">
            {t("ui.dateRange.to")}
          </label>
          <Input id={`${id}-to`} type="date" name={nameTo} value={range.to} min={range.from || undefined} required={required} invalid={Boolean(shown)} aria-describedby={shown ? errorId : undefined} onChange={(event) => set({ ...range, to: event.target.value })} />
        </div>
        {state === "ok" ? <p className="pb-2 text-sm text-ink-muted tabular">{tp("ui.dateRange.days", rangeDays(range.from, range.to))}</p> : null}
      </div>
      {today ? (
        <div role="group" aria-label={t("ui.dateRange.presets")} className="mt-2 flex flex-wrap gap-1.5">
          {presets
            .filter((preset) => RANGE_PRESETS.includes(preset))
            .map((preset) => {
              const value = presetRange(preset, today);
              const active = value.from === range.from && value.to === range.to;
              return (
                <Button key={preset} size="sm" aria-pressed={active} variant={active ? "primary" : "secondary"} onClick={() => set(value)}>
                  {t(`ui.dateRange.preset.${preset}`)}
                </Button>
              );
            })}
        </div>
      ) : null}
      {shown ? (
        <FieldError id={errorId} live>
          {shown}
        </FieldError>
      ) : null}
    </fieldset>
  );
}
