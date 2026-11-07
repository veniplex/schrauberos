"use client";

import { SubmitButton } from "@/components/ui/buttons";
import { Field, Form, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { addOrderFinding } from "./actions";

/** Neuen Befund (Freitext) zu einem offenen Auftrag erfassen. */
export function FindingForm({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <Form action={addOrderFinding} draftKey={`order-finding:${id}`} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Field label={t("orders.findings.add")} htmlFor="finding-text" name="text">
        <Textarea id="finding-text" name="text" maxLength={2000} rows={3} placeholder={t("orders.findings.placeholder")} />
      </Field>
      <div>
        <SubmitButton variant="secondary">{t("orders.findings.save")}</SubmitButton>
      </div>
    </Form>
  );
}
