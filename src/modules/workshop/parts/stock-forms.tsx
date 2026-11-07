"use client";

import type { ReactNode } from "react";
import { Field, Form, FormActions, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { SearchCombobox, type SearchOption } from "@/components/ui/search-combobox";
import { useI18n } from "@/i18n/client";
import { bookCount, receiveStock } from "./actions";

export type ArticleOption = SearchOption & { number: string; unit: string };

/** Auswahlfeld für Artikel (Nummer oder Bezeichnung). */
export function ArticleSelect({ initial, name = "articleId" }: { initial?: ArticleOption | null; name?: string }) {
  const { t } = useI18n();
  return (
    <SearchCombobox<ArticleOption>
      endpoint="/api/parts/search"
      name={name}
      initial={initial}
      placeholder={t("parts.searchPlaceholder")}
      required
      renderOption={(o) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="tabular font-medium">{o.number}</span>
          <span className="truncate">{o.sublabel}</span>
        </span>
      )}
      renderSelected={(o) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="tabular font-medium">{o.number}</span>
          <span className="truncate">{o.sublabel}</span>
        </span>
      )}
    />
  );
}

/** Wareneingang erfassen: Artikel, Menge, Lieferschein bzw. Nummer der Eingangsrechnung (von Hand eingetragen). */
export function ReceiptForm({ article, cancelHref }: { article: ArticleOption | null; cancelHref: string }) {
  const { t } = useI18n();
  return (
    <Form action={receiveStock} draftKey={`receipt:${article?.id ?? "new"}`} className="flex flex-col gap-5">
      <Card title={t("parts.sections.receipt")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("parts.fields.article")} name="articleId" required className="sm:col-span-3">
            {article ? (
              <>
                <input type="hidden" name="articleId" value={article.id} />
                <p className="text-sm">
                  <span className="tabular font-medium">{article.number}</span> <span className="ml-2 text-ink-muted">{article.sublabel}</span>
                </p>
              </>
            ) : (
              <ArticleSelect />
            )}
          </Field>
          <Field label={t("parts.fields.quantity")} htmlFor="quantity" name="quantity" required hint={article ? t("parts.fields.quantityUnit", { unit: article.unit }) : undefined}>
            <Input id="quantity" name="quantity" inputMode="decimal" autoComplete="off" />
          </Field>
          <Field label={t("parts.fields.reference")} htmlFor="reference" name="reference" hint={t("parts.fields.referenceHint")} className="sm:col-span-2">
            <Input id="reference" name="reference" maxLength={80} autoComplete="off" />
          </Field>
          <Field label={t("common.notes")} htmlFor="note" name="note" className="sm:col-span-3">
            <Input id="note" name="note" maxLength={500} />
          </Field>
        </div>
      </Card>
      <FormActions cancelHref={cancelHref} submitLabel={t("parts.receipt.save")} />
    </Form>
  );
}

export type CountRow = { id: string; number: string; name: string; unit: string; stock: string };

/**
 * Inventur: je Artikel Soll und Eingabe „gezählt“; nur ausgefüllte Zeilen werden gebucht (die Differenz als Korrektur). **Mobil** (unter `md`) steht jeder Artikel gestapelt: Name (umbrechend, volle
 * Zeile) mit Nummer und Soll darunter, die Eingabe darunter in voller Breite; ab `md` sind es drei Spalten (Name | Soll | Eingabe). Der Name wird nie auf eine Spalte von wenigen Zeichen gequetscht.
 */
export function CountForm({ rows, cancelHref, draftKey = "count", notice }: { rows: readonly CountRow[]; cancelHref: string; draftKey?: string; notice?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Form action={bookCount} draftKey={draftKey} className="flex flex-col gap-5">
      <Card title={t("parts.sections.count")}>
        <p className="mb-3 text-sm text-ink-muted">{t("parts.count.intro")}</p>
        {notice}
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} data-count-row="" className="grid grid-cols-1 gap-2 py-3 md:grid-cols-[minmax(0,1fr)_7rem_8rem] md:items-center md:gap-3 md:py-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium md:truncate">{row.name}</p>
                <p className="break-words text-xs text-ink-muted md:truncate">
                  <span className="tabular">{row.number}</span> · {t("parts.count.expected", { stock: row.stock, unit: row.unit })}
                </p>
              </div>
              <span className="hidden text-right text-sm text-ink-muted tabular md:block">
                {row.stock} {row.unit}
              </span>
              <Field label={t("parts.count.counted")} labelClassName="sr-only" htmlFor={`count-${row.id}`} name={`count.${row.id}`}>
                <Input id={`count-${row.id}`} name={`count.${row.id}`} inputMode="decimal" autoComplete="off" className="text-right tabular" />
              </Field>
            </li>
          ))}
        </ul>
        <Field label={t("parts.count.note")} htmlFor="count-note" name="note" className="mt-4">
          <Input id="count-note" name="note" maxLength={200} />
        </Field>
      </Card>
      <FormActions cancelHref={cancelHref} submitLabel={t("parts.count.save")} />
    </Form>
  );
}
