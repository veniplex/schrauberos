"use client";

import { Checkbox, Field, Form, FormActions, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { savePublicUrl, saveCspMode, saveSecurity } from "./actions";

export function SecurityForm({ behindProxy, auditRetentionDays, idleTimeoutHours, requireTwoFactorAdmins }: { behindProxy: boolean; auditRetentionDays: number; idleTimeoutHours: number; requireTwoFactorAdmins: boolean }) {
  const { t } = useI18n();
  return (
    <Form action={saveSecurity} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("settings.security.title")}>
        <Checkbox name="behindProxy" defaultChecked={behindProxy} label={t("settings.security.behindProxy")} hint={t("settings.security.behindProxyHint")} />
      </Card>
      <Card title={t("settings.security.sessionsTitle")}>
        <div className="flex flex-col gap-4">
          <Field label={t("settings.security.idleTimeout")} htmlFor="idleTimeoutHours" name="idleTimeoutHours" hint={t("settings.security.idleTimeoutHint")}>
            <Input id="idleTimeoutHours" name="idleTimeoutHours" type="number" min={0} max={720} defaultValue={idleTimeoutHours} />
          </Field>
          <Checkbox name="requireTwoFactorAdmins" defaultChecked={requireTwoFactorAdmins} label={t("settings.security.requireTwoFactor")} hint={t("settings.security.requireTwoFactorHint")} />
        </div>
      </Card>
      <Card title={t("audit.title")}>
        <Field label={t("settings.security.auditRetention")} htmlFor="auditRetentionDays" name="auditRetentionDays" hint={t("settings.security.auditRetentionHint")}>
          <Input id="auditRetentionDays" name="auditRetentionDays" type="number" min={0} max={3650} defaultValue={auditRetentionDays} />
        </Field>
      </Card>
      <FormActions />
    </Form>
  );
}

/** „Adresse der Anwendung“ (QR-Codes der Etiketten, Kalender-Abo): leer = nicht gesetzt. Nur die Herkunft, nie aus der Anfrage abgeleitet (`lib/public-url.ts`). */
export function PublicUrlForm({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <Form action={savePublicUrl} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("settings.security.publicUrl.title")}>
        <div className="flex flex-col gap-3">
          <Field label={t("settings.security.publicUrl.label")} htmlFor="publicUrl" name="publicUrl" hint={t("settings.security.publicUrl.hint")}>
            <Input id="publicUrl" name="publicUrl" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} defaultValue={value} placeholder="https://" />
          </Field>
          {value === "" ? <Alert tone="info">{t("settings.security.publicUrl.unset")}</Alert> : value.startsWith("http://") ? <Alert tone="info">{t("settings.security.publicUrl.httpNote")}</Alert> : null}
        </div>
      </Card>
      <FormActions />
    </Form>
  );
}

/** Notschalter der Content-Security-Policy (siehe `saveCspMode`): „nur melden“ statt erzwingen. */
export function CspModeForm({ reportOnly }: { reportOnly: boolean }) {
  const { t } = useI18n();
  return (
    <Form action={saveCspMode} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("settings.security.csp.title")}>
        <div className="flex flex-col gap-3">
          <Alert tone={reportOnly ? "warning" : "success"}>{reportOnly ? t("settings.security.csp.stateReportOnly") : t("settings.security.csp.stateEnforced")}</Alert>
          <Checkbox name="reportOnly" defaultChecked={reportOnly} label={t("settings.security.csp.reportOnly")} hint={t("settings.security.csp.hint")} />
        </div>
      </Card>
      <FormActions />
    </Form>
  );
}

/** Hinweis zur Verbindung: HTTPS erkannt (HSTS) oder unverschlüsselt (HTTP). Nur Information – im LAN ist HTTP üblich. */
export function HttpsNotice({ secure, behindProxy }: { secure: boolean; behindProxy: boolean }) {
  const { t } = useI18n();
  return (
    <Card title={t("settings.security.https.title")}>
      <div className="flex flex-col gap-3">
        <Alert tone={secure ? "success" : "info"}>{secure ? t("settings.security.https.secure") : t("settings.security.https.insecure")}</Alert>
        {!secure && behindProxy ? <Alert tone="warning">{t("settings.security.https.proxyMismatch")}</Alert> : null}
      </div>
    </Card>
  );
}
