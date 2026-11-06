"use client";

import { useActionState } from "react";
import { type ActionState, Checkbox, Field, FormMessage, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveSecurity } from "./actions";

export function SecurityForm({ behindProxy, auditRetentionDays }: { behindProxy: boolean; auditRetentionDays: number }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveSecurity, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("settings.security.title")}>
        <Checkbox name="behindProxy" defaultChecked={behindProxy} label={t("settings.security.behindProxy")} hint={t("settings.security.behindProxyHint")} />
      </Card>
      <Card title={t("audit.title")}>
        <Field label={t("settings.security.auditRetention")} htmlFor="auditRetentionDays" error={err.auditRetentionDays} hint={t("settings.security.auditRetentionHint")}>
          <Input id="auditRetentionDays" name="auditRetentionDays" type="number" min={0} max={3650} defaultValue={auditRetentionDays} invalid={!!err.auditRetentionDays} />
        </Field>
      </Card>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
