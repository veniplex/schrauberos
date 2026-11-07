"use client";

import { Checkbox, Field, Form, FormActions, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveUpdateToken } from "./actions";

export function UpdateTokenForm({ configured }: { configured: boolean }) {
  const { t } = useI18n();
  return (
    <Form action={saveUpdateToken} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("updates.settings.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("updates.settings.hint")}</p>
        <Field label={t("updates.settings.token")} htmlFor="token" hint={configured ? t("updates.settings.configured") : t("updates.settings.notConfigured")}>
          <Input id="token" name="token" type="password" autoComplete="off" placeholder={configured ? "••••••••" : "github_pat_…"} />
        </Field>
        {configured ? (
          <Checkbox name="remove" label={t("updates.settings.remove")} className="mt-3" />
        ) : null}
      </Card>
      <FormActions />
    </Form>
  );
}
