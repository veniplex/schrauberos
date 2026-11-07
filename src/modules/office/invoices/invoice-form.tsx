"use client";

import { useReducer } from "react";
import { Checkbox, Field, FileInput, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { SearchCombobox, type SearchOption } from "@/components/ui/search-combobox";
import { INVOICE_FILE_MAX_BYTES, INVOICE_STATUSES } from "@/modules/office/invoices/domain";
import { useI18n } from "@/i18n/client";
import { amountsReducer, grossSuggestion } from "./amounts";
import { saveInvoice } from "./actions";

export type InvoiceFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  direction: "incoming" | "outgoing";
  number: string;
  partyName: string;
  customer: SearchOption | null;
  issueDate: string;
  dueDate: string;
  net: string;
  vat: string;
  gross: string;
  status: string;
  paidAt: string;
  category: string;
  reference: string;
  notes: string;
  file: { name: string; size: number } | null;
};

/** `canPickCustomer`: Kundenauswahl nur anbieten, wenn die Funktion „Kunden“ aktiv ist (weiche Abhängigkeit). */
export function InvoiceForm({ initial, categories, cancelHref, canPickCustomer }: { initial: InvoiceFormInitial; categories: string[]; cancelHref: string; canPickCustomer: boolean }) {
  const { t, td, number } = useI18n();
  const outgoing = initial.direction === "outgoing";
  // Brutto aus Netto + MwSt. vorschlagen – solange Brutto nicht selbst eingegeben wurde
  const [amounts, change] = useReducer(amountsReducer, { net: initial.net, vat: initial.vat, gross: initial.gross, grossTouched: initial.gross !== "" });
  const grossTouched = amounts.grossTouched;
  const suggested = grossSuggestion(amounts.net, amounts.vat);

  return (
    <Form action={saveInvoice} draftKey={`invoice:${initial.id ?? initial.direction}`} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <input type="hidden" name="direction" value={initial.direction} />

      <Card title={outgoing ? t("invoices.sections.outgoing") : t("invoices.sections.incoming")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("invoices.fields.number")} htmlFor="number" name="number" required>
            <Input id="number" name="number" defaultValue={initial.number} maxLength={60} required autoComplete="off" className="font-mono" />
          </Field>
          <Field label={outgoing ? t("invoices.fields.recipient") : t("invoices.fields.supplier")} htmlFor="partyName" name="partyName" required>
            <Input id="partyName" name="partyName" defaultValue={initial.partyName} maxLength={120} required autoComplete="off" />
          </Field>
          {outgoing && canPickCustomer ? (
            <Field label={t("invoices.fields.customer")} name="customerId" hint={t("invoices.fields.customerHint")} className="sm:col-span-2">
              <SearchCombobox endpoint="/api/customers/search" name="customerId" initial={initial.customer} placeholder={t("customers.searchPlaceholder")} />
            </Field>
          ) : null}
          <Field label={t("invoices.fields.issueDate")} htmlFor="issueDate" name="issueDate" required>
            <Input id="issueDate" name="issueDate" type="date" defaultValue={initial.issueDate} required />
          </Field>
          <Field label={t("invoices.fields.dueDate")} htmlFor="dueDate" name="dueDate">
            <Input id="dueDate" name="dueDate" type="date" defaultValue={initial.dueDate} />
          </Field>
        </div>
      </Card>

      <Card title={t("invoices.sections.amounts")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("invoices.fields.net")} htmlFor="net" name="net">
            <Input id="net" name="net" inputMode="decimal" value={amounts.net} onChange={(e) => change({ field: "net", value: e.target.value })} placeholder="0,00" />
          </Field>
          <Field label={t("invoices.fields.vat")} htmlFor="vat" name="vat">
            <Input id="vat" name="vat" inputMode="decimal" value={amounts.vat} onChange={(e) => change({ field: "vat", value: e.target.value })} placeholder="0,00" />
          </Field>
          <Field label={t("invoices.fields.gross")} htmlFor="gross" name="gross" hint={!grossTouched && suggested ? t("invoices.fields.grossSuggested") : undefined} required>
            <Input
              id="gross"
              name="gross"
              inputMode="decimal"
              value={amounts.gross}
              onChange={(e) => change({ field: "gross", value: e.target.value })}
              placeholder="0,00"
              required
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-ink-muted">{t("invoices.fields.amountHint")}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("common.status")} htmlFor="status">
            <Select id="status" name="status" defaultValue={initial.status}>
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {td(`invoices.statuses.${s}`, s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("invoices.fields.paidAt")} htmlFor="paidAt" hint={t("invoices.fields.paidAtHint")}>
            <Input id="paidAt" name="paidAt" type="date" defaultValue={initial.paidAt} />
          </Field>
        </div>
      </Card>

      <Card title={t("invoices.sections.more")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("invoices.fields.category")} htmlFor="category">
            <Input id="category" name="category" list="invoice-categories" defaultValue={initial.category} maxLength={60} autoComplete="off" />
            <datalist id="invoice-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label={t("invoices.fields.reference")} htmlFor="reference" hint={t("invoices.fields.referenceHint")}>
            <Input id="reference" name="reference" defaultValue={initial.reference} maxLength={120} autoComplete="off" />
          </Field>
        </div>
        <Field label={t("common.notes")} htmlFor="notes" className="mt-4">
          <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
        </Field>
      </Card>

      <Card title={t("invoices.sections.file")}>
        {initial.file ? (
          <p className="mb-3 text-sm">
            {t("invoices.currentFile")}: <strong>{initial.file.name}</strong> <span className="text-ink-muted">({number(initial.file.size / 1024, { maximumFractionDigits: 0 })} KB)</span>
          </p>
        ) : null}
        <Field label={t("invoices.sections.file")} name="file" hint={initial.file ? t("invoices.fileReplaceHint") : t("invoices.fileHint")}>
          <FileInput name="file" accept="application/pdf,image/png,image/jpeg,image/webp,application/xml,text/xml,.xml" maxBytes={INVOICE_FILE_MAX_BYTES} />
        </Field>
        {initial.file ? (
          <Checkbox name="removeFile" label={t("invoices.removeFile")} className="mt-3" />
        ) : null}
      </Card>

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}
