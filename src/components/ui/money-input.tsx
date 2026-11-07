"use client";

import clsx from "clsx";
import { useState } from "react";
import type { InputHTMLAttributes } from "react";
import { useI18n } from "@/i18n/client";
import { centsToInputFor, parseMoneyToCents } from "@/lib/money";
import { Input } from "./form-fields";

/**
 * Geldbetragsfeld (ganze Cent): Zehnerblock mit Komma auf dem Handy (`inputMode="decimal"`), Eingabe wie „12,5“, „1.234,56“ oder „12.50“ (`parseMoneyToCents`, dieselbe Regel wie auf dem Server),
 * Ausgabe nach dem Verlassen des Feldes in der Schreibweise der Oberfläche („12,50“ bzw. „12.50“), Währungszeichen als Beschriftung am Rand. Ein nicht lesbarer Text bleibt stehen und
 * ist als ungültig markiert – er wird nie still verändert.
 *
 * **Gesteuert** (`value` als Text + `onValueChange`) oder **ungesteuert** (`defaultValue` in Cent). Das Formularfeld trägt den Text (`name`); der Server liest ihn mit `moneyCents` (`lib/zod-fields.ts`).
 * `onValueChange` meldet bei jeder Änderung den Text und die Cent (`null`: leer oder nicht lesbar).
 */
export function MoneyInput({
  value,
  defaultValue,
  onValueChange,
  onBlur,
  currency = "€",
  invalid,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "type" | "inputMode" | "onChange"> & {
  /** gesteuert: der Text im Feld */
  value?: string;
  /** ungesteuert: Anfangswert in Cent */
  defaultValue?: number | null;
  onValueChange?: (text: string, cents: number | null) => void;
  currency?: string;
  invalid?: boolean;
}) {
  const { locale, t } = useI18n();
  const [inner, setInner] = useState(() => centsToInputFor(defaultValue, locale));
  const [touched, setTouched] = useState(false);
  const text = value ?? inner;
  const cents = text.trim() === "" ? null : parseMoneyToCents(text);
  const unreadable = text.trim() !== "" && cents === null;

  function change(next: string) {
    if (value === undefined) setInner(next);
    onValueChange?.(next, next.trim() === "" ? null : parseMoneyToCents(next));
  }

  return (
    <div className={clsx("relative", className)}>
      <Input
        {...props}
        value={text}
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="next"
        invalid={invalid ?? (touched && unreadable)}
        title={touched && unreadable ? t("ui.money.invalid") : props.title}
        onChange={(event) => change(event.target.value)}
        onBlur={(event) => {
          setTouched(true);
          // lesbar: einheitlich schreiben; unlesbar oder leer: stehen lassen
          if (cents !== null) {
            const normalized = centsToInputFor(cents, locale);
            if (normalized !== text) change(normalized);
          }
          onBlur?.(event);
        }}
        className="pr-8 text-right tabular"
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">
        {currency}
      </span>
    </div>
  );
}
