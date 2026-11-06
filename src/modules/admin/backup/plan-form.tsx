"use client";

import { useActionState } from "react";
import { Field, FormMessage, Input, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveBackupPlan } from "./actions";

export function BackupPlanForm({ initial }: { initial: { enabled: boolean; hour: number; keep: number } }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveBackupPlan, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("backup.settings.title")}>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="size-4 accent-[var(--accent)]" />
            {t("backup.settings.enabled")}
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("backup.settings.hour")} htmlFor="hour" error={err.hour} hint={t("backup.settings.hourHint")}>
              <Input id="hour" name="hour" type="number" min={0} max={23} defaultValue={initial.hour} invalid={!!err.hour} />
            </Field>
            <Field label={t("backup.settings.keep")} htmlFor="keep" error={err.keep} hint={t("backup.settings.keepHint")}>
              <Input id="keep" name="keep" type="number" min={1} max={365} defaultValue={initial.keep} invalid={!!err.keep} />
            </Field>
          </div>
        </div>
      </Card>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
