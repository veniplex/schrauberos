"use client";

import { useCallback, useState } from "react";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Checkbox, Field, Form, FormActions, FormFieldError, FormMessage, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import { SecretField } from "@/components/ui/secret-field";
import { useI18n } from "@/i18n/client";
import { rotateWebhookSecret, saveWebhook, testWebhook } from "./actions";

export type EventGroup = { id: string; label: string; items: Array<{ type: string; label: string }> };
export type WebhookValues = { id?: string; version?: string; name: string; url: string; events: string[]; enabled: boolean; allowPrivate: boolean };

type SaveState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string; created?: { id: string; secret: string } };

/**
 * Webhook anlegen/ändern. **Anlegen:** Das Geheimnis der Signatur steht einmal in der Antwort (`SecretField once`, nur im Zustand dieser Komponente); das Ziel startet ausgeschaltet – erst wenn das Geheimnis
 * beim Empfänger steht, wird eingeschaltet. **Ändern:** Version für gleichzeitiges Bearbeiten. Die Ereignisse stammen aus dem Katalog der Funktionen (nur aktive). Ein Ziel im eigenen Netz (oder `http`)
 * braucht die ausdrückliche Freigabe.
 */
export function WebhookForm({ initial, groups, hasSecret }: { initial: WebhookValues; groups: EventGroup[]; hasSecret: boolean }) {
  const { t } = useI18n();
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const editing = Boolean(initial.id);

  const save = useCallback(async (prev: SaveState, formData: FormData) => {
    const result = (await saveWebhook(prev as never, formData)) as SaveState;
    if (result.created) {
      setCreated(result.created);
      const { created: _created, ...rest } = result;
      void _created;
      return rest;
    }
    return result;
  }, []);

  if (created) {
    return (
      <Card title={t("api.webhooks.createdTitle")}>
        <div className="flex flex-col gap-4">
          <Alert tone="success">{t("api.webhooks.createdHint")}</Alert>
          <SecretField value={created.secret} label={t("api.webhooks.secretLabel")} once autoHideSeconds={300} onDismiss={() => setCreated(null)} />
          <p className="text-sm text-ink-muted">{t("api.webhooks.createdNext")}</p>
          <div>
            <LinkButton variant="primary" href={`/admin/api/webhooks/${created.id}`}>
              {t("api.webhooks.openWebhook")}
            </LinkButton>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Form<SaveState> action={save} className="flex max-w-3xl flex-col gap-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial.version ? <input type="hidden" name="version" value={initial.version} /> : null}
      <Card title={t("api.webhooks.form.target")}>
        <div className="grid gap-4">
          <Field label={t("api.webhooks.form.name")} htmlFor="webhook-name" name="name" required>
            <Input id="webhook-name" name="name" maxLength={60} defaultValue={initial.name} required autoComplete="off" />
          </Field>
          <Field label={t("api.webhooks.form.url")} htmlFor="webhook-url" name="url" required hint={t("api.webhooks.form.urlHint")}>
            <Input id="webhook-url" name="url" type="url" maxLength={500} defaultValue={initial.url} placeholder="https://" required autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" />
          </Field>
          <Checkbox name="allowPrivate" defaultChecked={initial.allowPrivate} label={t("api.webhooks.form.allowPrivate")} hint={t("api.webhooks.form.allowPrivateHint")} />
        </div>
      </Card>

      <Card title={t("api.webhooks.form.events")}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{t("api.webhooks.form.eventsIntro")}</p>
          {groups.length === 0 ? <Alert tone="warning">{t("api.webhooks.form.noEvents")}</Alert> : null}
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((group) => (
              <fieldset key={group.id} className="m-0 min-w-0 rounded-md border border-line p-3">
                <legend className="px-1 text-sm font-semibold">{group.label}</legend>
                {group.items.map((event) => (
                  <Checkbox key={event.type} name="events" value={event.type} defaultChecked={initial.events.includes(event.type)} label={event.label} hint={<code className="text-[11px]">{event.type}</code>} />
                ))}
              </fieldset>
            ))}
          </div>
          <FormFieldError name="events" />
        </div>
      </Card>

      {editing ? (
        <Card title={t("api.webhooks.form.state")}>
          <Checkbox name="enabled" defaultChecked={initial.enabled} disabled={!hasSecret && !initial.enabled} label={t("api.webhooks.form.enabled")} hint={hasSecret ? t("api.webhooks.form.enabledHint") : t("api.webhooks.form.enabledNoSecret")} />
        </Card>
      ) : (
        <Alert tone="info">{t("api.webhooks.form.startsOff")}</Alert>
      )}
      <FormActions cancelHref="/admin/api/webhooks" submitLabel={editing ? t("common.save") : t("api.webhooks.form.create")} />
    </Form>
  );
}

type SecretState = { ok?: boolean; error?: string; message?: string; secret?: string; overlapHours?: number };

/** Neues Geheimnis erzeugen (Rotation): der Klartext steht einmal im Zustand dieser Komponente; das bisherige signiert während der Überlappung mit. */
export function RotateSecret({ id, hasSecret }: { id: string; hasSecret: boolean }) {
  const { t } = useI18n();
  const [fresh, setFresh] = useState<{ secret: string; overlapHours: number } | null>(null);
  const rotate = useCallback(async (prev: SecretState, formData: FormData) => {
    const result = (await rotateWebhookSecret(prev as never, formData)) as SecretState;
    if (result.secret) {
      setFresh({ secret: result.secret, overlapHours: result.overlapHours ?? 0 });
      return { ok: true } as SecretState;
    }
    return result;
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{hasSecret ? t("api.webhooks.secret.present") : t("api.webhooks.secret.missing")}</p>
      {fresh ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">{fresh.overlapHours > 0 ? t("api.webhooks.secret.rotated", { hours: fresh.overlapHours }) : t("api.webhooks.secret.issued")}</Alert>
          <SecretField value={fresh.secret} label={t("api.webhooks.secretLabel")} once autoHideSeconds={300} onDismiss={() => setFresh(null)} />
        </div>
      ) : null}
      <Form<SecretState> action={rotate} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <p className="text-xs text-ink-muted">{hasSecret ? t("api.webhooks.secret.rotateHint", { hours: 24 }) : t("api.webhooks.secret.issueHint")}</p>
        <FormMessage />
        <div>
          {hasSecret ? (
            <ConfirmSubmitButton variant="secondary" size="md" message={t("api.webhooks.secret.rotateConfirm")}>
              {t("api.webhooks.secret.rotate")}
            </ConfirmSubmitButton>
          ) : (
            <SubmitButton>{t("api.webhooks.secret.issue")}</SubmitButton>
          )}
        </div>
      </Form>
    </div>
  );
}

type TestState = { ok?: boolean; error?: string; test?: { outcome: string; status: number | null; error: string | null; durationMs: number | null } };

/** „Test-Ereignis senden“: ein Versuch mit Typ `webhook.test`; das Ergebnis (Statuscode oder Fehlercode) steht hier und im Zustellprotokoll. */
export function TestWebhook({ id }: { id: string }) {
  const { t, td } = useI18n();
  const [state, setState] = useState<TestState["test"] | null>(null);
  const run = useCallback(async (prev: TestState, formData: FormData) => {
    const result = (await testWebhook(prev as never, formData)) as TestState;
    setState(result.test ?? null);
    return result.test ? ({ ok: true } as TestState) : result;
  }, []);
  return (
    <Form<TestState> action={run} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-ink-muted">{t("api.webhooks.test.hint")}</p>
      {state ? (
        <Alert tone={state.outcome === "sent" ? "success" : "danger"}>
          {state.outcome === "sent"
            ? t("api.webhooks.test.ok", { status: state.status ?? 0, ms: state.durationMs ?? 0 })
            : state.status
              ? t("api.webhooks.test.httpFailed", { status: state.status })
              : t("api.webhooks.test.failed", { reason: td(`api.webhooks.errorCodes.${state.error ?? "connect"}`, state.error ?? "") })}
        </Alert>
      ) : null}
      <FormMessage />
      <div>
        <SubmitButton>{t("api.webhooks.test.send")}</SubmitButton>
      </div>
    </Form>
  );
}
