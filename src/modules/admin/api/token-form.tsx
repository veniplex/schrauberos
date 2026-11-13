"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/buttons";
import { CodeBlock } from "@/components/ui/code-block";
import { Checkbox, Field, Form, FormActions, FormFieldError, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, Badge, Card } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { SecretField } from "@/components/ui/secret-field";
import { useI18n } from "@/i18n/client";
import { TOKEN_EXPIRY_DAYS } from "@/lib/api/token-expiry";
import { createApiToken } from "./actions";

export type ScopeItem = { key: string; label: string; hint?: string; read: boolean; mark?: string };
export type ScopeGroup = { id: string; label: string; items: ScopeItem[] };

type TokenState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string; token?: { value: string; hint: string; expiresOn: string } };

const EXPIRY_DAYS = TOKEN_EXPIRY_DAYS;

/**
 * Neues API-Token anlegen: Name, Beschreibung, Ablauf, Rechte je Ressource (nichts ist vorgewählt; „Lesen“ und „Schreiben/Löschen“ sind getrennte Rechte), optional Adressbereiche, **erneute
 * Passwortabfrage**. Rechte mit Kennzeichnung (Versand, Festschreiben …) sind markiert und verlangen eine ausdrückliche Bestätigung. Der Klartext des Tokens steht **einmal** in der Antwort der Aktion und nur im
 * Zustand dieser Komponente (`SecretField once`); der Formularzustand trägt ihn nicht weiter. `base`: eingestellte Adresse der Anwendung für das Beispiel (sonst ein Platzhalter; nie aus dem Browser abgeleitet).
 */
export function TokenForm({ groups, markLabels, behindProxy, accounts, base }: { groups: ScopeGroup[]; markLabels: Record<string, string>; behindProxy: boolean; accounts: Array<{ id: string; name: string }>; base: string }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<{ value: string; hint: string; expiresOn: string } | null>(null);
  // Ohne Ablauf gibt es nur Tokens eines Dienstkontos: die Wahl hängt vom Besitzer ab
  const [owner, setOwner] = useState("");
  const [expiry, setExpiry] = useState("90");
  const unlimited = owner !== "" && expiry === "unlimited";

  const marked = groups.flatMap((g) => g.items).filter((item) => item.mark && selected.has(item.key));
  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const allRead = groups.flatMap((g) => g.items).filter((item) => item.read && !item.mark);

  const create = useCallback(async (prev: TokenState, formData: FormData) => {
    const result = (await createApiToken(prev as never, formData)) as TokenState;
    if (result.token) {
      setCreated(result.token);
      // der Zustand der Aktion trägt das Token nicht weiter: es bleibt nur hier
      const { token: _token, ...rest } = result;
      void _token;
      return rest;
    }
    return result;
  }, []);

  if (created) {
    return (
      <Card title={t("api.tokens.created")}>
        <div className="flex flex-col gap-4">
          <Alert tone="success">{created.expiresOn ? t("api.tokens.createdHint", { date: created.expiresOn }) : t("api.tokens.createdHintUnlimited")}</Alert>
          <SecretField value={created.value} label={t("api.tokens.secretLabel")} once autoHideSeconds={300} onDismiss={() => {
              setCreated(null);
              setSelected(new Set());
            }}
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">{t("api.tokens.example")}</p>
            <CodeBlock language="curl" label={t("api.tokens.exampleLabel")} code={`curl -H "Authorization: Bearer <TOKEN>" \\\n  ${base}/api/v1/customers`} />
            <p className="text-xs text-ink-muted">{t("api.tokens.exampleNote")}</p>
          </div>
          <div>
            <LinkButton href="/admin/api">{t("api.tokens.done")}</LinkButton>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Form<TokenState> action={create} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("api.tokens.form.basics")}>
        <div className="grid gap-4">
          {accounts.length > 0 ? (
            <Field label={t("api.tokens.form.owner")} htmlFor="token-owner" name="ownerId" hint={t("api.tokens.form.ownerHint")}>
              <Select
                id="token-owner"
                name="ownerId"
                defaultValue=""
                onChange={(event) => {
                  setOwner(event.target.value);
                  if (event.target.value === "") setExpiry((current) => (current === "unlimited" ? "90" : current));
                }}
              >
                <option value="">{t("api.tokens.form.ownerMe")}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({t("api.tokens.list.ownerService")})
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t("api.tokens.form.name")} htmlFor="token-name" name="name" required hint={t("api.tokens.form.nameHint")}>
            <Input id="token-name" name="name" maxLength={50} required autoComplete="off" />
          </Field>
          <Field label={t("api.tokens.form.description")} htmlFor="token-description" name="description">
            <Input id="token-description" name="description" maxLength={200} autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("api.tokens.form.expires")} htmlFor="token-expires" name="expiresInDays" hint={t("api.tokens.form.expiresHint")}>
              <Select id="token-expires" name="expiresInDays" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                {EXPIRY_DAYS.map((days) => (
                  <option key={days} value={days}>
                    {t("api.tokens.form.days", { days })}
                  </option>
                ))}
                {owner !== "" ? <option value="unlimited">{t("api.tokens.form.unlimited")}</option> : null}
              </Select>
            </Field>
            <Field label={t("api.tokens.form.rate")} htmlFor="token-rate" name="rateLimitPerMinute" hint={t("api.tokens.form.rateHint")}>
              <Input id="token-rate" name="rateLimitPerMinute" type="number" inputMode="numeric" min={1} max={6000} defaultValue={120} />
            </Field>
          </div>
          {unlimited ? <Alert tone="warning">{t("api.tokens.form.unlimitedWarning")}</Alert> : null}
        </div>
      </Card>

      <Card title={t("api.tokens.form.rights")}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{t("api.tokens.form.rightsIntro")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setSelected(new Set(allRead.map((item) => item.key)))}>
              {t("api.tokens.form.selectRead")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("api.tokens.form.selectNone")}
            </Button>
            <span className="self-center text-sm text-ink-muted" aria-live="polite">
              {t("api.tokens.form.selected", { count: selected.size })}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="grid gap-4 md:grid-cols-2">
              {groups.map((group) => (
                <fieldset key={group.id} className="m-0 min-w-0 rounded-md border border-line p-3">
                  <legend className="px-1 text-sm font-semibold">{group.label}</legend>
                  {group.items.map((item) => (
                    <div key={item.key}>
                      <Checkbox
                        name="scope"
                        value={item.key}
                        checked={selected.has(item.key)}
                        onChange={(event) => toggle(item.key, event.target.checked)}
                        label={
                          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                            {item.label}
                            {item.mark ? <Badge tone="warning">{markLabels[item.mark] ?? item.mark}</Badge> : null}
                          </span>
                        }
                        hint={item.hint}
                      />
                    </div>
                  ))}
                </fieldset>
              ))}
            </div>
            <FormFieldError name="scope" />
          </div>
          {marked.length > 0 ? (
            <Alert tone="warning">
              <p className="mb-2 font-medium">{t("api.tokens.form.markedWarning")}</p>
              <Checkbox name="acknowledgeMarked" label={t("api.tokens.form.markedConfirm")} required />
            </Alert>
          ) : null}
        </div>
      </Card>

      <Card title={t("api.tokens.form.network")}>
        <Field label={t("api.tokens.form.nets")} htmlFor="token-nets" name="allowedNets" hint={t("api.tokens.form.netsHint")}>
          <Textarea id="token-nets" name="allowedNets" rows={3} placeholder={"203.0.113.0/24\n2001:db8::/32"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="font-mono" disabled={!behindProxy} />
        </Field>
        {behindProxy ? null : <p className="mt-2 text-xs text-ink-muted">{t("api.tokens.form.netsNoProxy")}</p>}
      </Card>

      <Card title={t("api.tokens.form.confirm")}>
        <Field label={t("api.tokens.form.password")} htmlFor="token-password" name="password" required hint={t("api.tokens.form.passwordHint")}>
          <Input id="token-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
        </Field>
      </Card>

      <FormActions cancelHref="/admin/api" submitLabel={t("api.tokens.form.submit")} />
    </Form>
  );
}
