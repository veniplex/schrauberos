"use client";

import { useActionState } from "react";
import { type ActionState, Checkbox, Field, FieldError, FieldHint, FileInput, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { SearchCombobox, type SearchOption } from "@/components/ui/search-combobox";
import { INVOICE_STATUSES } from "@/modules/office/invoices/domain";
import { useI18n } from "@/i18n/client";
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
  const [state, action] = useActionState<ActionState, FormData>(saveInvoice, {});
  const err = state.fieldErrors ?? {};
  const outgoing = initial.direction === "outgoing";

  return (
    <form action={action} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <input type="hidden" name="direction" value={initial.direction} />

      <Card title={outgoing ? t("invoices.sections.outgoing") : t("invoices.sections.incoming")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("invoices.fields.number")} htmlFor="number" error={err.number} required>
            <Input id="number" name="number" defaultValue={initial.number} invalid={!!err.number} maxLength={60} required autoComplete="off" className="font-mono" />
          </Field>
          <Field label={outgoing ? t("invoices.fields.recipient") : t("invoices.fields.supplier")} htmlFor="partyName" error={err.partyName} required>
            <Input id="partyName" name="partyName" defaultValue={initial.partyName} invalid={!!err.partyName} maxLength={120} required autoComplete="off" />
          </Field>
          {outgoing && canPickCustomer ? (
            <Field label={t("invoices.fields.customer")} error={err.customerId} hint={t("invoices.fields.customerHint")} className="sm:col-span-2">
              <SearchCombobox endpoint="/api/customers/search" name="customerId" initial={initial.customer} placeholder={t("customers.searchPlaceholder")} invalid={!!err.customerId} />
            </Field>
          ) : null}
          <Field label={t("invoices.fields.issueDate")} htmlFor="issueDate" error={err.issueDate} required>
            <Input id="issueDate" name="issueDate" type="date" defaultValue={initial.issueDate} invalid={!!err.issueDate} required />
          </Field>
          <Field label={t("invoices.fields.dueDate")} htmlFor="dueDate" error={err.dueDate}>
            <Input id="dueDate" name="dueDate" type="date" defaultValue={initial.dueDate} invalid={!!err.dueDate} />
          </Field>
        </div>
      </Card>

      <Card title={t("invoices.sections.amounts")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("invoices.fields.net")} htmlFor="net" error={err.net}>
            <Input id="net" name="net" inputMode="decimal" defaultValue={initial.net} invalid={!!err.net} placeholder="0,00" />
          </Field>
          <Field label={t("invoices.fields.vat")} htmlFor="vat" error={err.vat}>
            <Input id="vat" name="vat" inputMode="decimal" defaultValue={initial.vat} invalid={!!err.vat} placeholder="0,00" />
          </Field>
          <Field label={t("invoices.fields.gross")} htmlFor="gross" error={err.gross} required>
            <Input id="gross" name="gross" inputMode="decimal" defaultValue={initial.gross} invalid={!!err.gross} placeholder="0,00" required />
          </Field>
        </div>
        <p className="mt-2 text-xs text-ink-muted">{t("invoices.fields.amountHint")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
        <div className="grid gap-4 sm:grid-cols-2">
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
        <FileInput name="file" accept="application/pdf,image/png,image/jpeg,image/webp" aria-label={t("invoices.sections.file")} />
        {err.file ? <FieldError>{err.file}</FieldError> : <FieldHint>{initial.file ? t("invoices.fileReplaceHint") : t("invoices.fileHint")}</FieldHint>}
        {initial.file ? (
          <Checkbox name="removeFile" label={t("invoices.removeFile")} className="mt-3" />
        ) : null}
      </Card>

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <LinkButton href={cancelHref}>
          {t("common.cancel")}
        </LinkButton>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
