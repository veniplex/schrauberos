"use client";

import { Alert, Card } from "@/components/ui/layout";
import { Checkbox, Field, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { saveVaultEntry } from "./vault-actions";
import { VAULT_KINDS, VAULT_LIMITS, type VaultKind, type VaultState } from "./vault-constants";

export type VaultFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  title: string;
  kind: VaultKind;
  system: string;
  /** Zustand des Eintrags beim Bearbeiten: bei `sealed` bleiben leere Felder unverändert; sonst gilt nur die neue Eingabe */
  state?: VaultState;
};

/**
 * Eintrag anlegen oder ändern (Rechte `docs.vaultManage` und `docs.vault`). Das Formular zeigt **nie** vorhandene Zugangsdaten (dafür gibt es die Anzeige mit Passwortabfrage): Beim Bearbeiten bleiben die
 * Felder leer, und ein leeres Feld lässt den bisherigen Wert stehen; „Entfernen“ leert ihn. Die Felder tragen `data-no-draft` – Zugangsdaten gehen nie in einen Formularentwurf im Browser. Wer die Zugangsdaten eines
 * bestehenden Eintrags ändert, bestätigt mit dem eigenen Passwort (Feld `password`).
 *
 * **Passwortmanager des Browsers:** Ein Formular aus „Benutzername“ und Passwortfeld wird als „Konto anlegen“ erkannt, und der Browser böte an, die Tresor-Zugangsdaten als Anmeldedaten **dieser Anwendung** zu
 * speichern (Kopie außerhalb von Audit und Tresor, Cloud-Abgleich, Vorschlag auf der Anmeldeseite). Deshalb: Feldnamen ohne `username`/`password` (`vault_account`, `vault_secret` …), das Geheimnis ist ein
 * **Textfeld, optisch verdeckt** (`Input masked`, kein `type="password"`: der Browser sieht dort kein Passwort), `autoComplete="off"` und die Ausnahmen der gängigen Passwortmanager (`data-1p-ignore`,
 * `data-lpignore`, `data-bwignore`, `data-form-type="other"`). Das einzige echte Passwortfeld ist die Bestätigung mit dem eigenen Passwort (`current-password`): ein vorhandener Anmeldeeintrag stimmt
 * damit überein, es gibt nichts Neues zu speichern. Wirkung nur im Browser prüfbar.
 */
const NO_MANAGER = { "data-no-draft": true, "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": true, "data-form-type": "other" } as const;

export function VaultForm({ initial, cancelHref }: { initial: VaultFormInitial; cancelHref: string }) {
  const { t } = useI18n();
  const editing = Boolean(initial.id);
  const keep = editing && initial.state === "sealed";

  const secretFields = [
    { name: "url", field: "vault_url", label: t("vault.fields.url"), max: VAULT_LIMITS.url, clear: "clearUrl" },
    { name: "username", field: "vault_account", label: t("vault.fields.username"), max: VAULT_LIMITS.username, clear: "clearUsername" },
  ] as const;

  return (
    <Form action={saveVaultEntry} className="flex max-w-3xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}

      <Alert tone="warning" live={false}>
        {t("vault.editorHint")}
      </Alert>

      <Card title={t("vault.sections.entry")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("vault.fields.title")} htmlFor="title" name="title" required hint={t("vault.fields.titleHint")} className="sm:col-span-2">
            <Input id="title" name="title" defaultValue={initial.title} maxLength={VAULT_LIMITS.title} required autoComplete="off" />
          </Field>
          <Field label={t("vault.fields.kind")} htmlFor="kind" name="kind" required>
            <Select id="kind" name="kind" defaultValue={initial.kind}>
              {VAULT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`vault.kind.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("vault.fields.system")} htmlFor="system" name="system" hint={t("vault.fields.systemHint")}>
            <Input id="system" name="system" defaultValue={initial.system} maxLength={VAULT_LIMITS.system} autoComplete="off" />
          </Field>
        </div>
      </Card>

      <Card title={t("vault.sections.credentials")}>
        {editing && !keep && initial.state === "unreadable" ? (
          <Alert tone="info" live={false} className="mb-4">
            {t("vault.editNotReadable")}
          </Alert>
        ) : null}
        <div className="grid grid-cols-1 gap-4">
          {secretFields.map((f) => (
            <div key={f.name} className="flex flex-col gap-2">
              <Field label={f.label} htmlFor={f.name} name={f.name} hint={keep ? t("vault.fields.keepHint") : undefined}>
                <Input id={f.name} name={f.field} type="text" maxLength={f.max} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} {...NO_MANAGER} />
              </Field>
              {keep ? <Checkbox name={f.clear} label={t("vault.fields.clearField", { field: f.label })} /> : null}
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <Field label={t("vault.fields.secret")} htmlFor="secret" name="secret" hint={keep ? t("vault.fields.keepHint") : undefined}>
              <Input id="secret" name="vault_secret" type="text" masked maxLength={VAULT_LIMITS.secret} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} {...NO_MANAGER} />
            </Field>
            {keep ? <Checkbox name="clearSecret" label={t("vault.fields.clearField", { field: t("vault.fields.secret") })} /> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Field label={t("vault.fields.note")} htmlFor="note" name="note" hint={keep ? `${t("vault.fields.noteHint")} ${t("vault.fields.keepHint")}` : t("vault.fields.noteHint")}>
              <Textarea id="note" name="vault_note" maxLength={VAULT_LIMITS.note} autoComplete="off" {...NO_MANAGER} />
            </Field>
            {keep ? <Checkbox name="clearNote" label={t("vault.fields.clearField", { field: t("vault.fields.note") })} /> : null}
          </div>
          {editing ? (
            <Field label={t("vault.fields.confirm")} htmlFor="vault-confirm" name="password" hint={t("vault.fields.confirmHint")}>
              <Input id="vault-confirm" name="password" type="password" autoComplete="current-password" data-no-draft />
            </Field>
          ) : null}
        </div>
      </Card>

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}
