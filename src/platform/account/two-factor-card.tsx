"use client";

import { useCallback, useState } from "react";
import { Checkbox, Field, FieldHint, Form, FormFieldError, FormMessage, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { BackupCodesView } from "./backup-codes-view";
import { QrCode } from "./qr-code";
import { disableTwoFactor, enableTwoFactor, regenerateBackupCodes, startTwoFactor, type TwoFactorSetupState } from "./security-actions";

type Setup = NonNullable<TwoFactorSetupState["setup"]>;
type Account = { name: string; username: string };

/** Textschlüssel in Vierergruppen (so lässt er sich in der App abtippen). */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/**
 * Zwei-Faktor-Anmeldung im Konto. Drei Zustände:
 *  - aus: Passwort eingeben → QR-Code, Textschlüssel und Sicherungscodes; **Aktivieren** verlangt einen Code aus der App und das Häkchen „Sicherungscodes gesichert“;
 *  - ein: Sicherungscodes neu erzeugen, ausschalten (beides mit Passwort);
 *  - verlangt (Richtlinie für Administratoren): wie „aus“, ohne Ausweg, bis der zweite Faktor eingerichtet ist.
 * Geheimnis und Codes stehen nur in den Antworten der Aktionen (Zustand dieser Komponente) – nirgends sonst.
 */
export function TwoFactorCard({ status, required, account }: { status: { enabled: boolean; enabledOn: string | null; codesLeft: number }; required: boolean; account: Account }) {
  const { t, tp } = useI18n();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [fresh, setFresh] = useState<{ codes: string[]; issuedOn?: string } | null>(null);

  const start = useCallback(async (prev: TwoFactorSetupState, formData: FormData) => {
    const result = (await startTwoFactor(prev as never, formData)) as TwoFactorSetupState;
    if (result.setup) setSetup(result.setup);
    return result;
  }, []);
  const regenerate = useCallback(async (prev: TwoFactorSetupState, formData: FormData) => {
    const result = (await regenerateBackupCodes(prev as never, formData)) as TwoFactorSetupState;
    if (result.backupCodes) setFresh({ codes: result.backupCodes, issuedOn: result.issuedOn });
    return result;
  }, []);

  if (!status.enabled && setup) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-ink-muted print:hidden">{t("security.twoFactor.setupIntro")}</p>
        <div className="grid gap-5 print:hidden md:grid-cols-[auto_1fr]">
          <QrCode matrix={setup.qr} label={t("security.twoFactor.qrLabel")} />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm font-medium">{t("security.twoFactor.step1")}</p>
            <p className="text-sm text-ink-muted">{t("security.twoFactor.noScan")}</p>
            <p data-testid="totp-secret" className="select-all break-words rounded-md border border-line-strong bg-surface-2 px-3 py-2 font-mono text-sm font-semibold tracking-wider">
              {grouped(setup.secret)}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium print:hidden">{t("security.twoFactor.step2")}</p>
          <BackupCodesView codes={setup.codes} issuedOn={setup.issuedOn} account={account} />
        </div>
        <Form action={enableTwoFactor} className="flex flex-col gap-3 print:hidden">
          <p className="text-sm font-medium">{t("security.twoFactor.step3")}</p>
          <Field label={t("security.twoFactor.code")} htmlFor="totp-code" name="code" hint={t("security.twoFactor.codeHint")} required>
            <Input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={12} className="font-mono tracking-widest" required />
          </Field>
          <div>
            <Checkbox name="backupConfirmed" label={t("security.twoFactor.codesSaved")} />
            <FormFieldError name="backupConfirmed" />
          </div>
          <FormMessage />
          <div>
            <SubmitButton>{t("security.twoFactor.enable")}</SubmitButton>
          </div>
        </Form>
      </div>
    );
  }

  if (!status.enabled) {
    return (
      <Form<TwoFactorSetupState> action={start} className="flex flex-col gap-4">
        {required ? <Alert tone="warning">{t("security.twoFactor.requiredNotice")}</Alert> : null}
        <p className="text-sm text-ink-muted">{t("security.twoFactor.intro")}</p>
        <p className="text-sm">{t("security.twoFactor.off")}</p>
        <Field label={t("security.twoFactor.password")} htmlFor="start-password" name="password" hint={t("security.twoFactor.passwordHint")} required>
          <Input id="start-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
        </Field>
        <FormMessage />
        <div>
          <SubmitButton>{t("security.twoFactor.start")}</SubmitButton>
        </div>
      </Form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 text-sm">
        <p>{t("security.twoFactor.on", { date: status.enabledOn ?? "–" })}</p>
        <p className="text-ink-muted">{tp("security.twoFactor.codesLeft", status.codesLeft)}</p>
        {status.codesLeft <= 2 ? <Alert tone="warning" className="mt-2">{t("security.twoFactor.fewCodes")}</Alert> : null}
      </div>

      {fresh ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold print:hidden">{t("security.twoFactor.newCodesTitle")}</h3>
          <BackupCodesView codes={fresh.codes} issuedOn={fresh.issuedOn} account={account} />
        </div>
      ) : null}

      <Form<TwoFactorSetupState> action={regenerate} className="flex flex-col gap-3 print:hidden">
        <h3 className="text-sm font-semibold">{t("security.twoFactor.regenerateTitle")}</h3>
        <FieldHint>{t("security.twoFactor.regenerateHint")}</FieldHint>
        <Field label={t("security.twoFactor.password")} htmlFor="regen-password" name="password" required>
          <Input id="regen-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
        </Field>
        <FormMessage />
        <div>
          <SubmitButton variant="secondary">{t("security.twoFactor.regenerate")}</SubmitButton>
        </div>
      </Form>

      {required ? (
        <Alert tone="info">{t("security.twoFactor.cannotDisable")}</Alert>
      ) : (
        <Form action={disableTwoFactor} className="flex flex-col gap-3 print:hidden">
          <h3 className="text-sm font-semibold">{t("security.twoFactor.disableTitle")}</h3>
          <Field label={t("security.twoFactor.password")} htmlFor="disable-password" name="password" required>
            <Input id="disable-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
          </Field>
          <FormMessage />
          <div>
            <ConfirmSubmitButton message={t("security.twoFactor.confirmDisable")} variant="danger" size="md">
              {t("security.twoFactor.disable")}
            </ConfirmSubmitButton>
          </div>
        </Form>
      )}
    </div>
  );
}
