"use client";

import { Checkbox, Field, Form, FormActions, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveSecurity } from "./actions";

export function SecurityForm({ behindProxy, auditRetentionDays }: { behindProxy: boolean; auditRetentionDays: number }) {
  const { t } = useI18n();
  return (
    <Form action={saveSecurity} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("settings.security.title")}>
        <Checkbox name="behindProxy" defaultChecked={behindProxy} label={t("settings.security.behindProxy")} hint={t("settings.security.behindProxyHint")} />
      </Card>
      <Card title={t("audit.title")}>
        <Field label={t("settings.security.auditRetention")} htmlFor="auditRetentionDays" name="auditRetentionDays" hint={t("settings.security.auditRetentionHint")}>
          <Input id="auditRetentionDays" name="auditRetentionDays" type="number" min={0} max={3650} defaultValue={auditRetentionDays} />
        </Field>
      </Card>
      <FormActions />
    </Form>
  );
}
