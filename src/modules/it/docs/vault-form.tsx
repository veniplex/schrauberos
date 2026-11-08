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
 * Eintrag anlegen oder ändern (Rechte `docsIt.vaultManage` und `docsIt.vault`). Das Formular zeigt **nie** vorhandene Zugangsdaten (dafür gibt es die Anzeige mit Passwortabfrage): Beim Bearbeiten bleiben die
 * Felder leer, und ein leeres Feld lässt den bisherigen Wert stehen; „Entfernen“ leert ihn. Die Felder tragen `data-no-draft` – Zugangsdaten gehen nie in einen Formularentwurf im Browser.
 */
export function VaultForm({ initial, cancelHref }: { initial: VaultFormInitial; cancelHref: string }) {
  const { t } = useI18n();
  const editing = Boolean(initial.id);
  const keep = editing && initial.state === "sealed";

  const secretFields = [
    { name: "url", label: t("vault.fields.url"), type: "text", max: VAULT_LIMITS.url, clear: "clearUrl" },
    { name: "username", label: t("vault.fields.username"), type: "text", max: VAULT_LIMITS.username, clear: "clearUsername" },
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
                <Input id={f.name} name={f.name} type={f.type} maxLength={f.max} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} data-no-draft />
              </Field>
              {keep ? <Checkbox name={f.clear} label={t("vault.fields.clearField", { field: f.label })} /> : null}
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <Field label={t("vault.fields.secret")} htmlFor="secret" name="secret" hint={keep ? t("vault.fields.keepHint") : undefined}>
              <Input id="secret" name="secret" type="password" maxLength={VAULT_LIMITS.secret} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} data-no-draft />
            </Field>
            {keep ? <Checkbox name="clearSecret" label={t("vault.fields.clearField", { field: t("vault.fields.secret") })} /> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Field label={t("vault.fields.note")} htmlFor="note" name="note" hint={keep ? `${t("vault.fields.noteHint")} ${t("vault.fields.keepHint")}` : t("vault.fields.noteHint")}>
              <Textarea id="note" name="note" maxLength={VAULT_LIMITS.note} data-no-draft autoComplete="off" />
            </Field>
            {keep ? <Checkbox name="clearNote" label={t("vault.fields.clearField", { field: t("vault.fields.note") })} /> : null}
          </div>
        </div>
      </Card>

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}
