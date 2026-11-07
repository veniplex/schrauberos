"use client";

import { Field, Form, FormActions, Input, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { MoneyInput } from "@/components/ui/money-input";
import { useI18n } from "@/i18n/client";
import { UNIT_SUGGESTIONS } from "./constants";
import { saveArticle } from "./actions";

export type ArticleFormInitial = {
  id?: string;
  version?: string;
  number: string;
  name: string;
  unit: string;
  supplier: string;
  taxRate: string;
  minStock: string;
  notes: string;
  /** Preise in Cent; `undefined`: Der Betrachter darf sie nicht sehen – das Formular hat dann keine Preisfelder */
  purchaseCents?: number | null;
  saleCents?: number | null;
};

/** Artikel anlegen/bearbeiten. Preisfelder (Einkauf, Verkauf) gibt es nur mit `parts.prices`; der Bestand ändert sich nie hier, sondern nur über Buchungen. */
export function ArticleForm({ initial, cancelHref, showPrices }: { initial: ArticleFormInitial; cancelHref: string; showPrices: boolean }) {
  const { t } = useI18n();
  return (
    <Form action={saveArticle} draftKey={`article:${initial.id ?? "new"}`} className="flex flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      {showPrices ? <input type="hidden" name="pricesShown" value="1" /> : null}

      <Card title={t("parts.sections.article")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("parts.fields.number")} htmlFor="number" name="number" required hint={t("parts.fields.numberHint")}>
            <Input id="number" name="number" defaultValue={initial.number} maxLength={40} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          </Field>
          <Field label={t("parts.fields.name")} htmlFor="name" name="name" required className="sm:col-span-2">
            <Input id="name" name="name" defaultValue={initial.name} maxLength={120} />
          </Field>
          <Field label={t("parts.fields.unit")} htmlFor="unit" name="unit">
            <Input id="unit" name="unit" list="part-units" defaultValue={initial.unit} maxLength={10} />
            <datalist id="part-units">
              {UNIT_SUGGESTIONS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </Field>
          <Field label={t("parts.fields.supplier")} htmlFor="supplier" name="supplier" className="sm:col-span-2">
            <Input id="supplier" name="supplier" defaultValue={initial.supplier} maxLength={120} />
          </Field>
          <Field label={t("parts.fields.minStock")} htmlFor="minStock" name="minStock" hint={t("parts.fields.minStockHint")}>
            <Input id="minStock" name="minStock" inputMode="decimal" defaultValue={initial.minStock} />
          </Field>
          <Field label={t("parts.fields.taxRate")} htmlFor="taxRate" name="taxRate">
            <Input id="taxRate" name="taxRate" inputMode="decimal" defaultValue={initial.taxRate} />
          </Field>
        </div>
        <Field label={t("common.notes")} htmlFor="notes" name="notes" className="mt-4">
          <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
        </Field>
      </Card>

      {showPrices ? (
        <Card title={t("parts.sections.prices")}>
          <p className="mb-3 text-sm text-ink-muted">{t("parts.fields.pricesHint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t("parts.fields.purchase")} htmlFor="purchase" name="purchase">
              <MoneyInput id="purchase" name="purchase" defaultValue={initial.purchaseCents} />
            </Field>
            <Field label={t("parts.fields.sale")} htmlFor="sale" name="sale">
              <MoneyInput id="sale" name="sale" defaultValue={initial.saleCents} />
            </Field>
          </div>
        </Card>
      ) : null}

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}
