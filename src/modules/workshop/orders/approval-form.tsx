"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/ui/buttons";
import { Field, Form, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Signature } from "@/components/ui/signature";
import { useI18n } from "@/i18n/client";
import { approveOrder } from "./actions";

/**
 * Kundenfreigabe bei Mehrarbeit protokollieren: freigegebener Mehrbetrag (brutto), Begründung, freigebende Person und die Art – Unterschrift am Tablet (Zeichenfeld oder getippter Name mit
 * Bestätigung) oder telefonisch. Der Eintrag ist danach unveränderlich; die Seite zeigt das Formular nur mit `orders.edit` und `orders.prices` an einem offenen Auftrag.
 */
export function ApprovalForm({ id }: { id: string }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<"signature" | "phone">("signature");
  return (
    <Form action={approveOrder} draftKey={`order-approval:${id}`} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t("orders.approvals.amount")} htmlFor="approval-amount" name="amount" hint={t("orders.approvals.amountHint")} required>
          <MoneyInput id="approval-amount" name="amount" />
        </Field>
        <Field label={t("orders.approvals.approver")} htmlFor="approval-approver" name="approverName" required>
          <Input id="approval-approver" name="approverName" maxLength={80} autoComplete="off" />
        </Field>
        <Field label={t("orders.approvals.method")} htmlFor="approval-method" name="method">
          <Select id="approval-method" name="method" value={method} onChange={(event) => setMethod(event.target.value === "phone" ? "phone" : "signature")}>
            <option value="signature">{t("orders.approvals.methods.signature")}</option>
            <option value="phone">{t("orders.approvals.methods.phone")}</option>
          </Select>
        </Field>
      </div>
      <Field label={t("orders.approvals.reason")} htmlFor="approval-reason" name="reason" required>
        <Textarea id="approval-reason" name="reason" maxLength={1000} rows={3} />
      </Field>
      {method === "signature" ? (
        <Field label={t("orders.approvals.signature")} name="signature" required>
          <Signature name="signature" />
        </Field>
      ) : (
        <p className="text-sm text-ink-muted">{t("orders.approvals.phoneHint")}</p>
      )}
      <div>
        <SubmitButton variant="secondary">{t("orders.approvals.save")}</SubmitButton>
      </div>
    </Form>
  );
}
