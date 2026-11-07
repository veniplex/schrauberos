"use client";

import { useState } from "react";
import { Alert, Card } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/buttons";
import { Checkbox, Field, Form, FormActions, FormMessage, Input, Select } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
// nur Typen aus dem Server-Code: `lib/mail.ts` nutzt `node:url` und gehört nicht in das Bündel des Browsers
import type { MailSecurity } from "@/lib/mail";
import type { MailSettings } from "@/server/mail/settings";
import { saveMailSettings, sendTestMailAction, testMailConnectionAction } from "./actions";

/** Üblicher Anschluss je Verschlüsselung: wird beim Wechsel vorgeschlagen, solange der Anschluss noch ein Standardwert war. */
const STANDARD_PORT: Record<MailSecurity, number> = { starttls: 587, smtps: 465, none: 25 };
const SECURITY_MODES: readonly MailSecurity[] = ["starttls", "smtps", "none"];

export function MailSettingsForm({ initial, hasPassword }: { initial: MailSettings; hasPassword: boolean }) {
  const { t } = useI18n();
  const [security, setSecurity] = useState<MailSecurity>(initial.security);
  const [port, setPort] = useState(String(initial.port));

  function changeSecurity(next: MailSecurity) {
    if (Object.values(STANDARD_PORT).map(String).includes(port)) setPort(String(STANDARD_PORT[next]));
    setSecurity(next);
  }

  return (
    <Form action={saveMailSettings} className="flex max-w-3xl flex-col gap-5" draftKey="mail-settings">
      <Card title={t("mail.form.connection")}>
        <div className="flex flex-col gap-4">
          <Checkbox name="enabled" defaultChecked={initial.enabled} label={t("mail.form.enabled")} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label={t("mail.form.host")} htmlFor="host" name="host" hint={t("mail.form.hostHint")}>
              <Input id="host" name="host" defaultValue={initial.host} maxLength={253} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="smtp.example.org" />
            </Field>
            <Field label={t("mail.form.port")} htmlFor="port" name="port" required>
              <Input id="port" name="port" type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} required />
            </Field>
          </div>
          <Field label={t("mail.form.security")} htmlFor="security" name="security" hint={t("mail.form.securityHint")}>
            <Select id="security" name="security" value={security} onChange={(event) => changeSecurity(event.target.value as MailSecurity)}>
              {SECURITY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`mail.form.securityOptions.${mode}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("mail.form.user")} htmlFor="user" name="user" hint={t("mail.form.userHint")}>
            <Input id="user" name="user" defaultValue={initial.user} maxLength={200} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </Field>
          <Field label={t("mail.form.password")} htmlFor="password" name="password" hint={hasPassword ? `${t("mail.form.passwordSet")} ${t("mail.form.passwordHint")}` : t("mail.form.passwordHint")}>
            <Input id="password" name="password" type="password" maxLength={1024} autoComplete="new-password" />
          </Field>
          {hasPassword ? <Checkbox name="clearPassword" label={t("mail.form.passwordClear")} /> : null}
          <Checkbox name="allowPrivate" defaultChecked={initial.allowPrivate} label={t("mail.form.allowPrivate")} hint={t("mail.form.allowPrivateHint")} />
          {security === "none" ? (
            <div className="flex flex-col gap-3">
              <Alert tone="warning">{t("mail.form.plainWarning")}</Alert>
              <Checkbox name="plainConfirmed" defaultChecked={initial.plainConfirmed} label={t("mail.form.plainConfirmed")} />
            </div>
          ) : null}
        </div>
      </Card>

      <Card title={t("mail.form.sender")}>
        <div className="flex flex-col gap-4">
          <Field label={t("mail.form.fromAddress")} htmlFor="fromAddress" name="fromAddress">
            <Input id="fromAddress" name="fromAddress" type="email" defaultValue={initial.fromAddress} maxLength={254} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </Field>
          <Field label={t("mail.form.fromName")} htmlFor="fromName" name="fromName" hint={t("mail.form.fromNameHint")}>
            <Input id="fromName" name="fromName" defaultValue={initial.fromName} maxLength={80} autoComplete="off" />
          </Field>
          <Field label={t("mail.form.replyTo")} htmlFor="replyTo" name="replyTo" hint={t("mail.form.replyToHint")}>
            <Input id="replyTo" name="replyTo" type="email" defaultValue={initial.replyTo} maxLength={254} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </Field>
        </div>
      </Card>

      <Card title={t("mail.form.limits")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("mail.form.limitHour")} htmlFor="limitHour" name="limitHour" required>
            <Input id="limitHour" name="limitHour" type="number" min={0} max={100000} defaultValue={initial.limits.hour} required />
          </Field>
          <Field label={t("mail.form.limitDay")} htmlFor="limitDay" name="limitDay" required>
            <Input id="limitDay" name="limitDay" type="number" min={0} max={100000} defaultValue={initial.limits.day} required />
          </Field>
          <Field label={t("mail.form.limitUserHour")} htmlFor="limitUserHour" name="limitUserHour" required>
            <Input id="limitUserHour" name="limitUserHour" type="number" min={0} max={100000} defaultValue={initial.limits.userHour} required />
          </Field>
          <Field label={t("mail.form.limitUserDay")} htmlFor="limitUserDay" name="limitUserDay" required>
            <Input id="limitUserDay" name="limitUserDay" type="number" min={0} max={100000} defaultValue={initial.limits.userDay} required />
          </Field>
        </div>
        <p className="mt-3 text-xs text-ink-muted">{t("mail.form.limitHint")}</p>
      </Card>
      <FormActions />
    </Form>
  );
}

/** Prüfen mit den gespeicherten Einstellungen: Verbindungstest (nur Handshake und Anmeldung) und Test-Mail an die eigene Adresse. */
export function MailChecks({ ownAddress }: { ownAddress: string | null }) {
  const { t } = useI18n();
  return (
    <Card title={t("mail.actions.title")} className="max-w-3xl">
      <p className="mb-4 text-sm text-ink-muted">{t("mail.actions.hint")}</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Form action={testMailConnectionAction} className="flex flex-col gap-2">
          <SubmitButton variant="secondary">{t("mail.actions.testConnection")}</SubmitButton>
          <FormMessage />
        </Form>
        <Form action={sendTestMailAction} className="flex flex-col gap-2">
          <SubmitButton variant="secondary" disabled={!ownAddress}>
            {t("mail.actions.testSend")}
          </SubmitButton>
          <p className="text-xs text-ink-muted">{ownAddress ? t("mail.actions.testSendHint", { address: ownAddress }) : t("mail.actions.noOwnAddress")}</p>
          <FormMessage />
        </Form>
      </div>
    </Card>
  );
}
