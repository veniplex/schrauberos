"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Checkbox, Field, FormMessage, Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { RecoveryCodeView } from "@/platform/account/recovery-code-view";
import { confirmRecoveryCode } from "@/platform/account/recovery-actions";
import type { RecoveryActionState } from "@/lib/recovery-code";
import { Alert } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
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

export function SetupForm({ timezones, done = false }: { timezones: string[]; done?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, action] = useActionState<RecoveryActionState, FormData>(completeSetup, {});
  const browserZone = useBrowserTimezone();
  const [chosen, setChosen] = useState<string | null>(null);
  const zone = chosen ?? (timezones.includes(browserZone) ? browserZone : DEFAULT_ZONE);
  const err = state.fieldErrors ?? {};

  // Nach der Einrichtung: eigene Seite für den Wiederherstellungs-Code mit Pflicht-Bestätigung (der Code steht nur in dieser Antwort)
  if (state.recoveryCode) {
    return (
      <RecoveryCodeView
        code={state.recoveryCode}
        issuedOn={state.issuedOn}
        onConfirm={confirmRecoveryCode}
        onContinue={() => router.push("/")}
      />
    );
  }
  // Die Einrichtung ist abgeschlossen (Seite neu geladen): der Code wird nur einmal angezeigt
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info">{t("recovery.setupDoneReload")}</Alert>
        <LinkButton href="/" variant="primary">
          {t("recovery.continue")}
        </LinkButton>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t("setup.token")} htmlFor="token" error={err.token} hint={t("setup.tokenHint")} required>
        <Input id="token" name="token" invalid={!!err.token} maxLength={100} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus required />
      </Field>
      <Field label={t("setup.workshopName")} htmlFor="workshopName" error={err.workshopName} required>
        <Input id="workshopName" name="workshopName" invalid={!!err.workshopName} maxLength={80} required />
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
        <Input id="password" name="password" type="password" maxLength={128} invalid={!!err.password} autoComplete="new-password" required />
      </Field>
      <Field label={t("account.confirmPassword")} htmlFor="confirm" error={err.confirm} required>
        <Input id="confirm" name="confirm" type="password" maxLength={128} invalid={!!err.confirm} autoComplete="new-password" required />
      </Field>

      <Checkbox name="demo" label={t("setup.demo")} hint={t("setup.demoHint")} />

      <FormMessage state={state} />
      <SubmitButton className="w-full">{t("setup.submit")}</SubmitButton>
    </form>
  );
}
