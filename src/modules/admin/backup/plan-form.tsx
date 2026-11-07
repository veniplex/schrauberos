"use client";

import { Checkbox, Field, Form, FormActions, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { BACKUP_KINDS, type BackupKind } from "@/server/backup/kinds";
import { saveBackupPlan } from "./actions";

type Retention = Record<BackupKind, { keep: number; days: number }>;

export function BackupPlanForm({ initial, limits }: { initial: { enabled: boolean; hour: number; retention: Retention }; limits: { keep: number; days: number } }) {
  const { t, td } = useI18n();
  return (
    <Form action={saveBackupPlan} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("backup.settings.title")}>
        <div className="flex flex-col gap-4">
          <Checkbox name="enabled" defaultChecked={initial.enabled} label={t("backup.settings.enabled")} />
          <Field label={t("backup.settings.hour")} htmlFor="hour" name="hour" hint={t("backup.settings.hourHint")} className="sm:max-w-xs">
            <Input id="hour" name="hour" type="number" required min={0} max={23} defaultValue={initial.hour} />
          </Field>
        </div>
      </Card>
      <Card title={t("backup.retention.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("backup.retention.intro")}</p>
        <div className="flex flex-col gap-5">
          {BACKUP_KINDS.map((kind) => (
            <div key={kind} className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr_1fr] sm:items-start">
              <p className="pt-2 text-sm font-medium">{td(`backup.kinds.${kind}`, kind)}</p>
              <Field label={t("backup.retention.keep")} htmlFor={`keep_${kind}`} name={`keep_${kind}`}>
                <Input id={`keep_${kind}`} name={`keep_${kind}`} type="number" required min={0} max={limits.keep} defaultValue={initial.retention[kind].keep} />
              </Field>
              <Field label={t("backup.retention.days")} htmlFor={`days_${kind}`} name={`days_${kind}`}>
                <Input id={`days_${kind}`} name={`days_${kind}`} type="number" required min={0} max={limits.days} defaultValue={initial.retention[kind].days} />
              </Field>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-muted">{t("backup.retention.note")}</p>
      </Card>
      <FormActions />
    </Form>
  );
}
