"use client";

import clsx from "clsx";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useId, useMemo, useReducer, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { INTL_LOCALE } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import {
  createEditorState,
  editorReducer,
  evaluateRows,
  lineResult,
  MAX_LINES,
  parseDraft,
  rowsFromItems,
  serializeDraft,
  serializeSubmit,
  type EditorAction,
  type EditorField,
  type EditorRow,
  type EditorState,
} from "@/lib/line-items";
import { formatCents } from "@/lib/money";
import { Button } from "./buttons";
import { Field, Input, Select } from "./form-fields";
import { useFormContext } from "./form-context";
import { DRAFT_STATE_EVENT } from "./form-draft";
import { MoneyInput } from "./money-input";

/**
 * Positionen-Editor für Angebote, Aufträge und Rechnungen: Beschreibung, Menge, Einheit, Netto-Einzelpreis, Steuersatz, Rabatt und der Summenblock (Netto, Rabatt, Steuer je Satz, Brutto).
 *
 *  - **Rechnet nach einer Regel** (`lib/line-items.ts`: ganze Cent, Steuer je Satz auf der Summe gerundet, Kleinunternehmer ohne Steuer); der Server rechnet mit denselben Funktionen nach und glaubt dem Browser
 *    nur die Eingaben, nie die Summen. **Jede Änderung rechnet aus dem aktuellen Zustand** (`useReducer`) – wichtig für die Wiederherstellung eines Entwurfs, die mehrere Felder nacheinander schreibt.
 *  - **Formular:** Das Absendefeld `name` (versteckt) trägt die Positionen als JSON mit Zahlen (`serializeSubmit`, gelesen mit `lineItemsInput()`); Fehler des Servers (`items.2.unitCents` …) erscheinen an der
 *    Zeile und dem Feld, wenn der umgebende `Form` sie meldet (oder über `errors`). Der Entwurf läuft über ein Zustandsfeld (`data-draft-state`): Zeilen werden mit wiederhergestellt.
 *  - **Layout:** Unter `md` je Position eine Karte (Felder paarweise), die Summenleiste klebt am unteren Rand (über der Aktionsleiste des Formulars); breiter: Zeilen in einer Zeile. Die Umstellung hängt an der
 *    Breite des Editors (Container-Abfrage), nicht des Bildschirms – neben der Navigation reicht ein Tablet im Hochformat für Karten, nicht für eine Tabellenzeile.
 *  - **Tastatur:** Eingabe springt zum nächsten Feld (ohne das Formular abzusenden), nach dem letzten Feld der letzten Zeile entsteht eine neue Position.
 */
const DEFAULT_TAX_RATES = ["19", "7", "0"] as const;
const COLUMNS = "@5xl:grid-cols-[minmax(0,1fr)_5.5rem_5rem_8rem_6.5rem_5.5rem_7rem_8rem]";

export type LineItemInitial = Parameters<typeof rowsFromItems>[0][number];
const FIELD_OF_SERVER: Record<string, EditorField> = { description: "description", quantityMilli: "quantity", unit: "unit", unitCents: "unitPrice", taxBp: "taxRate", discountBp: "discount" };

/** Fehler des Servers (`items.2.unitCents` → `2.unitPrice`) auf Zeile und Feld des Editors abbilden. */
export function mapLineItemErrors(fieldErrors: Record<string, string> | undefined, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    const match = new RegExp(`^(?:${name}\\.)?(\\d+)\\.(\\w+)$`).exec(path);
    const field = match ? FIELD_OF_SERVER[match[2]] : undefined;
    if (match && field) out[`${match[1]}.${field}`] ??= message;
  }
  return out;
}

export function LineItemEditor({
  name = "items",
  initialItems = [],
  taxRates = DEFAULT_TAX_RATES,
  defaultTaxRate = "19",
  exempt = false,
  errors,
  disabled,
}: {
  /** Name des Absendefeldes (Standard „items“) */
  name?: string;
  /** vorhandene Positionen (Bearbeiten) als gespeicherte Zahlen */
  initialItems?: readonly LineItemInitial[];
  /** wählbare Steuersätze in Prozent, als Text */
  taxRates?: readonly string[];
  defaultTaxRate?: string;
  /** steuerfrei (Kleinunternehmer § 19 UStG): keine Steuer, der Satz ist fest 0 */
  exempt?: boolean;
  /** Fehler je Feld, Schlüssel `<Zeile>.<Feld>` (Feld: description, quantity, unit, unitPrice, taxRate, discount); Standard: aus dem umgebenden `Form` */
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const { t, tp, locale } = useI18n();
  const form = useFormContext();
  const headingId = useId();
  const root = useRef<HTMLDivElement>(null);
  const defaults = useMemo(() => ({ taxRate: exempt ? "0" : defaultTaxRate }), [exempt, defaultTaxRate]);
  const [state, dispatch] = useReducer((current: EditorState, action: EditorAction) => editorReducer(current, action, defaults), undefined, () => createEditorState(rowsFromItems(initialItems, locale), defaults));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const pendingFocus = useRef<string | null>(null);

  const rows = useMemo(() => (exempt ? state.rows.map((row) => ({ ...row, taxRate: "0" })) : state.rows), [state.rows, exempt]);
  const evaluation = useMemo(() => evaluateRows(rows, { exempt }), [rows, exempt]);
  const { totals } = evaluation;
  const money = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const serverErrors = errors ?? mapLineItemErrors(form?.state.fieldErrors, name);

  // Wiederherstellung eines Entwurfs: der Rahmen schickt den gemerkten Zustand (Zeilen als Text) an das Zustandsfeld
  const stateField = useCallback((element: HTMLInputElement | null) => {
    if (!element) return;
    const handler = (event: Event) => dispatch({ type: "replace", rows: parseDraft(String((event as CustomEvent<string>).detail ?? "")) });
    element.addEventListener(DRAFT_STATE_EVENT, handler);
    return () => element.removeEventListener(DRAFT_STATE_EVENT, handler);
  }, []);

  // eine neue Zeile nimmt den Fokus (Beschreibung), sobald sie im DOM steht
  const focusNew = useCallback((element: HTMLInputElement | null, key: string) => {
    if (element && pendingFocus.current === key) {
      pendingFocus.current = null;
      element.focus();
    }
  }, []);

  function addRow() {
    if (state.rows.length >= MAX_LINES) return;
    pendingFocus.current = `r${state.nextKey}`;
    dispatch({ type: "add" });
  }
  const set = (key: string, field: EditorField, value: string) => dispatch({ type: "set", key, field, value });
  const touch = (key: string, field: EditorField) => setTouched((current) => (current.has(`${key}:${field}`) ? current : new Set(current).add(`${key}:${field}`)));

  // Eingabe springt zum nächsten Feld (ein Absenden mitten in der Erfassung wäre ärgerlich); nach dem letzten Feld entsteht eine neue Position
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (event.key !== "Enter" || !(target instanceof HTMLInputElement) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const inputs = Array.from(root.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type='hidden']):not([disabled]), select:not([disabled])") ?? []);
    const next = inputs[inputs.indexOf(target) + 1];
    if (next) next.focus();
    else addRow();
  }

  const issueText = (index: number, key: string, field: EditorField): string | undefined => {
    const server = serverErrors[`${index}.${field}`];
    if (server) return server;
    const issue = (evaluation.rows[index]?.issues as Record<string, string | undefined> | undefined)?.[field];
    const row = state.rows[index];
    const shown = touched.has(`${key}:${field}`) || (row && row[field].trim() !== "");
    return issue && shown ? t("ui.lineItems.invalidField") : undefined;
  };

  const grossText = money(totals.grossCents);
  return (
    <div ref={root} role="group" aria-labelledby={headingId} onKeyDown={onKeyDown} className="@container flex flex-col gap-3">
      <p id={headingId} className="field-label">
        {t("ui.lineItems.group")}
      </p>
      <input type="hidden" name={name} value={serializeSubmit(rows)} data-lineitems="" />
      <input ref={stateField} type="hidden" data-draft-state={name} value={serializeDraft(state.rows)} readOnly />

      {state.rows.length === 0 ? <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-ink-muted">{t("ui.lineItems.empty")}</p> : null}

      {state.rows.length > 0 ? (
        <div aria-hidden className={clsx("hidden gap-2 px-0 text-xs text-ink-muted @5xl:grid", COLUMNS)}>
          <span>{t("ui.lineItems.description")}</span>
          <span className="text-right">{t("ui.lineItems.quantity")}</span>
          <span>{t("ui.lineItems.unit")}</span>
          <span className="text-right">{t("ui.lineItems.unitPrice")}</span>
          <span>{t("ui.lineItems.taxRate")}</span>
          <span className="text-right">{t("ui.lineItems.discount")}</span>
          <span className="text-right">{t("ui.lineItems.lineNet")}</span>
          <span />
        </div>
      ) : null}

      <ul className="flex flex-col gap-3 @5xl:gap-2">
        {state.rows.map((row: EditorRow, index) => {
          const parsed = evaluation.rows[index]?.parsed;
          const lineNet = parsed ? money(lineResult(parsed).netCents) : "–";
          const options = taxRates.includes(row.taxRate) || exempt ? taxRates : [...taxRates, row.taxRate];
          return (
            <li key={row.key} role="group" aria-label={t("ui.lineItems.position", { n: index + 1 })} className={clsx("grid grid-cols-2 gap-3 rounded-md border border-line bg-surface p-3 @lg:grid-cols-4", "@5xl:items-start @5xl:gap-2 @5xl:border-0 @5xl:bg-transparent @5xl:p-0", COLUMNS)}>
              <p className="col-span-full flex items-center justify-between text-sm font-semibold @5xl:sr-only">{t("ui.lineItems.position", { n: index + 1 })}</p>
              <Field className="col-span-full @5xl:col-span-1" label={t("ui.lineItems.description")} labelClassName="@5xl:sr-only" error={issueText(index, row.key, "description")}>
                <Input
                  ref={(element) => focusNew(element, row.key)}
                  value={row.description}
                  maxLength={300}
                  disabled={disabled}
                  autoComplete="off"
                  onChange={(event) => set(row.key, "description", event.target.value)}
                  onBlur={() => touch(row.key, "description")}
                />
              </Field>
              <Field label={t("ui.lineItems.quantity")} labelClassName="@5xl:sr-only" error={issueText(index, row.key, "quantity")}>
                <Input value={row.quantity} inputMode="decimal" disabled={disabled} autoComplete="off" className="text-right tabular" onChange={(event) => set(row.key, "quantity", event.target.value)} onBlur={() => touch(row.key, "quantity")} />
              </Field>
              <Field label={t("ui.lineItems.unit")} labelClassName="@5xl:sr-only" error={issueText(index, row.key, "unit")}>
                <Input value={row.unit} maxLength={20} disabled={disabled} autoComplete="off" onChange={(event) => set(row.key, "unit", event.target.value)} />
              </Field>
              <Field label={t("ui.lineItems.unitPrice")} labelClassName="@5xl:sr-only" error={issueText(index, row.key, "unitPrice")}>
                <MoneyInput value={row.unitPrice} disabled={disabled} onValueChange={(text) => set(row.key, "unitPrice", text)} onBlur={() => touch(row.key, "unitPrice")} />
              </Field>
              <Field label={t("ui.lineItems.taxRate")} labelClassName="@5xl:sr-only" error={issueText(index, row.key, "taxRate")}>
                <Select value={exempt ? "0" : row.taxRate} disabled={disabled || exempt} onChange={(event) => set(row.key, "taxRate", event.target.value)}>
                  {options.map((rate) => (
                    <option key={rate} value={rate}>
                      {t("ui.lineItems.taxOption", { rate })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("ui.lineItems.discount")} labelClassName="@5xl:sr-only" error={issueText(index, row.key, "discount")}>
                <Input value={row.discount} inputMode="decimal" disabled={disabled} autoComplete="off" className="text-right tabular" onChange={(event) => set(row.key, "discount", event.target.value)} onBlur={() => touch(row.key, "discount")} />
              </Field>
              <div className="flex min-h-(--tap) flex-col justify-center text-right @5xl:min-h-(--tap)">
                <span className="text-xs text-ink-muted @5xl:sr-only">{t("ui.lineItems.lineNet")}</span>
                <output aria-label={`${t("ui.lineItems.lineNet")}: ${lineNet}`} className="tabular text-sm font-medium">
                  {lineNet}
                </output>
              </div>
              <div className="col-span-2 flex items-center justify-end gap-1 @lg:col-span-2 @5xl:col-span-1">
                <Button size="icon-sm" variant="ghost" disabled={disabled || index === 0} aria-label={t("ui.lineItems.moveUp", { n: index + 1 })} onClick={() => dispatch({ type: "move", key: row.key, delta: -1 })}>
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button size="icon-sm" variant="ghost" disabled={disabled || index === state.rows.length - 1} aria-label={t("ui.lineItems.moveDown", { n: index + 1 })} onClick={() => dispatch({ type: "move", key: row.key, delta: 1 })}>
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={t("ui.lineItems.remove", { n: index + 1 })} onClick={() => dispatch({ type: "remove", key: row.key })}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button disabled={disabled || state.rows.length >= MAX_LINES} onClick={addRow}>
          <Plus className="size-4" aria-hidden /> {t("ui.lineItems.add")}
        </Button>
        {state.rows.length >= MAX_LINES ? <p className="text-sm text-ink-muted">{t("ui.lineItems.limit", { max: MAX_LINES })}</p> : null}
        {!evaluation.valid ? (
          <p role="status" className="text-sm text-danger-ink">
            {t("ui.lineItems.invalid")}
          </p>
        ) : null}
      </div>

      <dl aria-label={t("ui.lineItems.summary")} className="ml-auto flex w-full max-w-sm flex-col gap-1 border-t border-line pt-3 text-sm @5xl:max-w-md">
        {totals.discountCents !== 0 ? (
          <>
            <Row label={t("ui.lineItems.base")} value={money(totals.baseCents)} />
            <Row label={t("ui.lineItems.discountTotal")} value={money(-totals.discountCents)} />
          </>
        ) : null}
        <Row label={t("ui.lineItems.net")} value={money(totals.netCents)} />
        {exempt ? (
          <Row label={t("ui.lineItems.taxExempt")} value={money(0)} muted />
        ) : (
          totals.taxGroups.map((group) => <Row key={group.taxBp} label={t("ui.lineItems.tax", { rate: formatRate(group.taxBp, locale) })} value={money(group.taxCents)} muted />)
        )}
        <Row label={t("ui.lineItems.gross")} value={grossText} strong />
      </dl>

      {/* nur Handy/Tablet hochkant: die Summe bleibt beim Blättern sichtbar, über der Aktionsleiste des Formulars (--toast-lift) und der Aussparung unten */}
      <div aria-hidden className="sticky bottom-[var(--toast-lift,0px)] z-10 -mx-1 flex items-center justify-between gap-3 rounded-md border border-line glass-bar px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-sm md:hidden">
        <span className="text-ink-muted">{tp("ui.lineItems.count", state.rows.length)}</span>
        <span className="text-base font-semibold tabular">{t("ui.lineItems.totalBar", { gross: grossText })}</span>
      </div>
    </div>
  );
}

function formatRate(bp: number, locale: "de" | "en"): string {
  const text = String(bp / 100);
  return locale === "de" ? text.replace(".", ",") : text;
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-4", strong && "border-t border-line pt-1.5 text-base font-semibold", muted && "text-ink-muted")}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
