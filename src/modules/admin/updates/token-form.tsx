"use client";

import { useActionState } from "react";
import { Field, FormMessage, Input, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveUpdateToken } from "./actions";

export function UpdateTokenForm({ configured }: { configured: boolean }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveUpdateToken, {});
  return (
    <form action={action} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("updates.settings.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("updates.settings.hint")}</p>
        <Field label={t("updates.settings.token")} htmlFor="token" hint={configured ? t("updates.settings.configured") : t("updates.settings.notConfigured")}>
          <Input id="token" name="token" type="password" autoComplete="off" placeholder={configured ? "••••••••" : "github_pat_…"} />
        </Field>
        {configured ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="remove" className="size-4 accent-[var(--accent)]" /> {t("updates.settings.remove")}
          </label>
        ) : null}
      </Card>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
