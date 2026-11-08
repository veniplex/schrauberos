"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Checkbox, Field, Form, FormMessage, Input, Select } from "@/components/ui/form";
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

export type SetupPreset = { id: string; name: string; description: string };

export function SetupForm({ timezones, presets = [], done = false }: { timezones: string[]; presets?: SetupPreset[]; done?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const browserZone = useBrowserTimezone();
  const [chosen, setChosen] = useState<string | null>(null);
  const zone = chosen ?? (timezones.includes(browserZone) ? browserZone : DEFAULT_ZONE);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const preset = presets.find((p) => p.id === presetId);

  return (
    <Form<RecoveryActionState> action={completeSetup} className="flex flex-col gap-4">
      {(state) =>
        // Nach der Einrichtung: eigene Seite für den Wiederherstellungs-Code mit Pflicht-Bestätigung (der Code steht nur in dieser Antwort).
        // Das Formular bleibt dafür immer eingehängt: Direkt nach dem Anlegen rendert Next die Seite mit der neuen Sitzung noch einmal (`done`), und ein
        // früher Rückgabewert vor dem Formular würde den Antwortzustand mit dem Code verwerfen – der Code wäre nie zu sehen.
        state.recoveryCode ? (
          <RecoveryCodeView code={state.recoveryCode} issuedOn={state.issuedOn} onConfirm={() => confirmRecoveryCode(new FormData())} onContinue={() => router.push("/")} />
        ) : done ? (
          // Die Einrichtung ist abgeschlossen (Seite neu geladen): der Code wird nur einmal angezeigt
          <div className="flex flex-col gap-4">
            <Alert tone="info">{t("recovery.setupDoneReload")}</Alert>
            <LinkButton href="/" variant="primary">
              {t("recovery.continue")}
            </LinkButton>
          </div>
        ) : (
          <>
      <Field label={t("setup.token")} htmlFor="token" name="token" hint={t("setup.tokenHint")} required>
        <Input id="token" name="token" maxLength={100} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus required />
      </Field>
      <Field label={t("setup.workshopName")} htmlFor="workshopName" name="workshopName" required>
        <Input id="workshopName" name="workshopName" maxLength={80} required />
      </Field>
      <Field label={t("setup.timezone")} htmlFor="timezone" name="timezone" hint={t("setup.timezoneHint")}>
        <Select id="timezone" name="timezone" value={zone} onChange={(e) => setChosen(e.target.value)}>
          {timezones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>

      {presets.length > 0 ? (
        <Field label={t("setup.preset")} htmlFor="preset" name="preset" hint={[preset?.description, t("setup.presetHint")].filter(Boolean).join(" ")}>
          <Select id="preset" name="preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <hr className="border-line" />
      <p className="text-sm font-medium">{t("setup.adminTitle")}</p>
      <Field label={t("users.fields.name")} htmlFor="name" name="name" required>
        <Input id="name" name="name" maxLength={120} autoComplete="name" required />
      </Field>
      <Field label={t("users.fields.username")} htmlFor="username" name="username" hint={t("users.fields.usernameHint")} required>
        <Input id="username" name="username" autoComplete="username" autoCapitalize="none" required />
      </Field>
      <Field label={t("users.fields.password")} htmlFor="password" name="password" hint={t("account.passwordRules")} required>
        <Input id="password" name="password" type="password" maxLength={128} autoComplete="new-password" required />
      </Field>
      <Field label={t("account.confirmPassword")} htmlFor="confirm" name="confirm" required>
        <Input id="confirm" name="confirm" type="password" maxLength={128} autoComplete="new-password" required />
      </Field>

      <Checkbox name="demo" label={t("setup.demo")} hint={t("setup.demoHint")} />

            <FormMessage />
            <SubmitButton className="w-full">{t("setup.submit")}</SubmitButton>
          </>
        )
      }
    </Form>
  );
}
