"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { type ActionState, Checkbox, Field, FormMessage, Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { completeSetup } from "./actions";

const noopSubscribe = () => () => {};
const DEFAULT_ZONE = "Europe/Berlin";

/** Zeitzone des Browsers als Vorschlag (auf dem Server gilt der Standardwert; kein Hydration-Konflikt). */
function useBrowserTimezone(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => DEFAULT_ZONE,
  );
}

export function SetupForm({ timezones }: { timezones: string[] }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(completeSetup, {});
  const browserZone = useBrowserTimezone();
  const [chosen, setChosen] = useState<string | null>(null);
  const zone = chosen ?? (timezones.includes(browserZone) ? browserZone : DEFAULT_ZONE);
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t("setup.workshopName")} htmlFor="workshopName" error={err.workshopName} required>
        <Input id="workshopName" name="workshopName" invalid={!!err.workshopName} maxLength={80} autoFocus required />
      </Field>
      <Field label={t("setup.timezone")} htmlFor="timezone" error={err.timezone} hint={t("setup.timezoneHint")}>
        <Select id="timezone" name="timezone" value={zone} onChange={(e) => setChosen(e.target.value)}>
          {timezones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>

      <hr className="border-line" />
      <p className="text-sm font-medium">{t("setup.adminTitle")}</p>
      <Field label={t("users.fields.name")} htmlFor="name" error={err.name} required>
        <Input id="name" name="name" invalid={!!err.name} maxLength={120} autoComplete="name" required />
      </Field>
      <Field label={t("users.fields.username")} htmlFor="username" error={err.username} hint={t("users.fields.usernameHint")} required>
        <Input id="username" name="username" invalid={!!err.username} autoComplete="username" autoCapitalize="none" required />
      </Field>
      <Field label={t("users.fields.password")} htmlFor="password" error={err.password} hint={t("account.passwordRules")} required>
        <Input id="password" name="password" type="password" invalid={!!err.password} autoComplete="new-password" required />
      </Field>
      <Field label={t("account.confirmPassword")} htmlFor="confirm" error={err.confirm} required>
        <Input id="confirm" name="confirm" type="password" invalid={!!err.confirm} autoComplete="new-password" required />
      </Field>

      <Checkbox name="demo" label={t("setup.demo")} hint={t("setup.demoHint")} />

      <FormMessage state={state} />
      <SubmitButton className="w-full">{t("setup.submit")}</SubmitButton>
    </form>
  );
}
