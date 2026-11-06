"use client";

import { useActionState } from "react";
import { type ActionState, Checkbox, FormMessage } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveSecurity } from "./actions";

export function SecurityForm({ behindProxy }: { behindProxy: boolean }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveSecurity, {});
  return (
    <form action={action} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("settings.security.title")}>
        <Checkbox name="behindProxy" defaultChecked={behindProxy} label={t("settings.security.behindProxy")} hint={t("settings.security.behindProxyHint")} />
      </Card>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
