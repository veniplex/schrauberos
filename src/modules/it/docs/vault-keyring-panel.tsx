"use client";

import { Lock, LockOpen } from "lucide-react";
import { SubmitButton } from "@/components/ui/buttons";
import { Disclosure } from "@/components/ui/disclosure";
import { Checkbox, Field, Form, FormActions, Input } from "@/components/ui/form";
import { Alert, Badge, Card, DangerZone } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { changeVaultPassphrase, lockVault, resetVault, setupVault, unlockVault, unlockVaultWithRecoveryKey } from "./vault-actions";

/** Passwortmanager des Browsers sollen die Tresor-Passphrase weder speichern noch vorschlagen (wie die Felder der Einträge, `vault-form.tsx`) */
const NO_MANAGER = { "data-no-draft": true, "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": true, "data-form-type": "other" } as const;

export type VaultKeyringView = {
  state: "notSetUp" | "locked" | "unlocked";
  /** Hülle für den Wiederherstellungsschlüssel vorhanden */
  recovery: boolean;
  /** Seit wann (formatiert) und von wem entsperrt – nur im Zustand `unlocked` */
  since: string | null;
  by: string | null;
};

function OwnPassword({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <Field label={t("vault.keyring.password")} htmlFor={id} name="password" required hint={t("vault.keyring.passwordHint")}>
      <Input id={id} name="password" type="password" required autoComplete="current-password" data-no-draft />
    </Field>
  );
}

function NewPassphrase({ idPrefix }: { idPrefix: string }) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t("vault.keyring.passphrase")} htmlFor={`${idPrefix}-pass`} name="passphrase" required hint={t("vault.keyring.passphraseHint")}>
        <Input id={`${idPrefix}-pass`} name="vault_passphrase" type="password" required minLength={12} maxLength={256} autoComplete="off" {...NO_MANAGER} />
      </Field>
      <Field label={t("vault.keyring.confirm")} htmlFor={`${idPrefix}-confirm`} name="confirm" required>
        <Input id={`${idPrefix}-confirm`} name="vault_passphrase_confirm" type="password" required maxLength={256} autoComplete="off" {...NO_MANAGER} />
      </Field>
    </>
  );
}

/**
 * Der Zustand des Tresor-Schlüssels (Schlüsselkonzept, README „IT-Tresor“): **nicht eingerichtet** (Passphrase festlegen), **gesperrt** (nach jedem Neustart: Passphrase oder Wiederherstellungsschlüssel eingeben),
 * **entsperrt** (sperren, Passphrase ändern, zurücksetzen). Jedes Formular verlangt das eigene Passwort; die Passphrase-Felder tragen `data-no-draft` und die Ausnahmen für Passwortmanager.
 */
export function VaultKeyringPanel({ view, canManage }: { view: VaultKeyringView; canManage: boolean }) {
  const { t } = useI18n();
  const badge = (
    <Badge tone={view.state === "unlocked" ? "success" : view.state === "locked" ? "warning" : "neutral"}>
      {view.state === "unlocked" ? <LockOpen className="mr-1 inline size-3" aria-hidden /> : <Lock className="mr-1 inline size-3" aria-hidden />}
      {t(`vault.keyring.state.${view.state}`)}
    </Badge>
  );

  if (view.state === "notSetUp") {
    return (
      <Card title={t("vault.keyring.setup.title")} actions={badge}>
        {canManage ? (
          <Form action={setupVault} className="flex max-w-md flex-col gap-4">
            <p className="text-sm text-ink-muted">{t("vault.keyring.notSetUp")}</p>
            <NewPassphrase idPrefix="setup" />
            <OwnPassword id="setup-password" />
            <FormActions submitLabel={t("vault.keyring.setup.submit")} />
          </Form>
        ) : (
          <p className="text-sm text-ink-muted">{t("vault.keyring.notSetUpNoRight")}</p>
        )}
      </Card>
    );
  }

  if (view.state === "locked") {
    return (
      <div className="flex flex-col gap-4">
        <Card title={t("vault.keyring.unlock.title")} actions={badge}>
          <Form action={unlockVault} className="flex max-w-md flex-col gap-4">
            <p className="text-sm text-ink-muted">{t("vault.keyring.locked")}</p>
            <Field label={t("vault.keyring.passphrase")} htmlFor="unlock-pass" name="passphrase" required>
              <Input id="unlock-pass" name="vault_passphrase" type="password" required maxLength={2048} autoComplete="off" {...NO_MANAGER} />
            </Field>
            <OwnPassword id="unlock-password" />
            <FormActions submitLabel={t("vault.keyring.unlock.submit")} />
          </Form>
        </Card>
        <Disclosure title={t("vault.keyring.recovery.title")} variant="card">
          {view.recovery ? (
            <Form action={unlockVaultWithRecoveryKey} className="flex max-w-md flex-col gap-4">
              <Field label={t("vault.keyring.recovery.key")} htmlFor="recovery-key" name="recoveryKey" required hint={t("vault.keyring.recovery.keyHint")}>
                <Input id="recovery-key" name="vault_recovery_key" type="password" required maxLength={200} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} {...NO_MANAGER} />
              </Field>
              <OwnPassword id="recovery-password" />
              <FormActions submitLabel={t("vault.keyring.recovery.submit")} />
            </Form>
          ) : (
            <p className="text-sm text-ink-muted">{t("vault.keyring.recovery.none")}</p>
          )}
        </Disclosure>
        {canManage ? <ResetZone /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("vault.keyring.title")} actions={badge}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-80 text-sm text-ink-muted">{t("vault.keyring.unlocked", { time: view.since ?? "–", name: view.by ?? "–" })}</p>
          <form action={lockVault}>
            <SubmitButton variant="secondary">
              <Lock className="size-4" aria-hidden /> {t("vault.keyring.lock")}
            </SubmitButton>
          </form>
        </div>
      </Card>
      {canManage ? (
        <>
          <Disclosure title={t("vault.keyring.change.title")} variant="card">
            <Form action={changeVaultPassphrase} className="flex max-w-md flex-col gap-4">
              <p className="text-sm text-ink-muted">{t("vault.keyring.change.hint")}</p>
              <NewPassphrase idPrefix="change" />
              <OwnPassword id="change-password" />
              <FormActions submitLabel={t("vault.keyring.change.submit")} />
            </Form>
          </Disclosure>
          <ResetZone />
        </>
      ) : null}
    </div>
  );
}

function ResetZone() {
  const { t } = useI18n();
  return (
    <DangerZone title={t("vault.keyring.reset.title")}>
      <Form action={resetVault} className="flex max-w-md flex-col gap-4">
        <Alert tone="danger" live={false}>
          {t("vault.keyring.reset.text")}
        </Alert>
        <Checkbox name="confirm" label={t("vault.keyring.reset.confirm")} required />
        <OwnPassword id="reset-password" />
        <FormActions submitLabel={t("vault.keyring.reset.submit")} />
      </Form>
    </DangerZone>
  );
}
