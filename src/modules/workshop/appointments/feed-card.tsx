"use client";

import { useCallback, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Field, Form, FormMessage, Input, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/layout";
import { SecretField } from "@/components/ui/secret-field";
import { useI18n } from "@/i18n/client";
import { FEED_EXPIRY_CHOICES } from "./feed-constants";
import { createFeed, revokeFeed } from "./actions";

export type FeedStatus = { hint: string; createdOn: string; expiresOn: string | null; expired: boolean; lastUsedOn: string | null };
type FeedState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string; feed?: { token: string } };

/** `https://x.example/api/ical/…` → `webcal://x.example/api/ical/…` (öffnet die Kalender-App des Geräts). */
const webcalOf = (url: string) => url.replace(/^https?:/, "webcal:");

/**
 * Kalender-Abo einrichten (F10): Status der Abo-Adresse (nie der Klartext – gespeichert ist nur der Hash), **Erzeugen/Erneuern** und **Widerrufen**, beides mit Passwortabfrage. Der Klartext der Adresse steht
 * **einmal** in der Antwort der Aktion und nur im Zustand dieser Komponente: `SecretField once` (verborgen, „Anzeigen“, „Kopieren“, „Ausblenden“ wirft ihn weg), dazu ein Knopf, der den webcal-Link öffnet (die Adresse steht dafür nie als Link im Dokument, nur im Zustand). Der Zustand der Aktion trägt das Token nicht weiter (es wird hier herausgenommen).
 * `base`: die eingestellte Adresse der Anwendung; ohne sie gilt die Adresse, unter der diese Seite geöffnet ist.
 */
export function FeedCard({ status, base }: { status: FeedStatus | null; base: string | null }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);

  const create = useCallback(
    async (prev: FeedState, formData: FormData) => {
      const result = (await createFeed(prev as never, formData)) as FeedState;
      if (result.feed) {
        // die Adresse aus der Einstellung (oder der geöffneten Adresse) und dem Token; das Token bleibt nur hier
        setUrl(`${base ?? window.location.origin}/api/ical/${result.feed.token}.ics`);
        const { feed: _feed, ...rest } = result;
        void _feed;
        return rest;
      }
      return result;
    },
    [base],
  );

  return (
    <div className="flex flex-col gap-5">
      {url ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">{t("appointments.feedPage.created")}</Alert>
          <SecretField value={url} label={t("appointments.feedPage.secretLabel")} once onDismiss={() => setUrl(null)} />
          <div className="flex flex-col gap-1">
            <div>
              {/* kein Link im Dokument: Die Adresse steht sonst als href im DOM, auch solange das SecretField sie verbirgt */}
              <Button onClick={() => window.location.assign(webcalOf(url))}>
                <CalendarPlus className="size-4" aria-hidden /> {t("appointments.feedPage.open")}
              </Button>
            </div>
            <p className="text-xs text-ink-muted">{t("appointments.feedPage.openHint")}</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1 text-sm">
        {status ? (
          <>
            <p>{t("appointments.feedPage.status.active", { date: status.createdOn, hint: status.hint })}</p>
            <p className={status.expired ? "text-danger-ink" : "text-ink-muted"}>{status.expired ? t("appointments.feedPage.status.expired", { date: status.expiresOn ?? "" }) : status.expiresOn ? t("appointments.feedPage.status.expires", { date: status.expiresOn }) : t("appointments.feedPage.status.neverExpires")}</p>
            <p className="text-ink-muted">{status.lastUsedOn ? t("appointments.feedPage.status.lastUsed", { date: status.lastUsedOn }) : t("appointments.feedPage.status.neverUsed")}</p>
          </>
        ) : (
          <p>{t("appointments.feedPage.status.none")}</p>
        )}
      </div>

      <Form<FeedState> action={create} className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{status ? t("appointments.feedPage.create.titleRenew") : t("appointments.feedPage.create.title")}</h3>
        {status ? <p className="text-sm text-ink-muted">{t("appointments.feedPage.create.renewHint")}</p> : null}
        <Field label={t("appointments.feedPage.create.password")} htmlFor="feed-create-password" name="password" hint={t("appointments.feedPage.create.passwordHint")} required>
          <Input id="feed-create-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
        </Field>
        <Field label={t("appointments.feedPage.create.expiry")} htmlFor="feed-expires" name="expires">
          <Select id="feed-expires" name="expires" defaultValue="never">
            {FEED_EXPIRY_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {t(`appointments.feedPage.create.expiryChoices.${choice}`)}
              </option>
            ))}
          </Select>
        </Field>
        <FormMessage />
        <div>
          <SubmitButton>{status ? t("appointments.feedPage.create.submitRenew") : t("appointments.feedPage.create.submit")}</SubmitButton>
        </div>
      </Form>

      {status ? (
        <Form action={revokeFeed} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t("appointments.feedPage.revoke.title")}</h3>
          <p className="text-sm text-ink-muted">{t("appointments.feedPage.revoke.hint")}</p>
          <Field label={t("appointments.feedPage.create.password")} htmlFor="feed-revoke-password" name="password" required>
            <Input id="feed-revoke-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
          </Field>
          <FormMessage />
          <div>
            <ConfirmSubmitButton message={t("appointments.feedPage.revoke.confirm")} variant="danger" size="md">
              {t("appointments.feedPage.revoke.submit")}
            </ConfirmSubmitButton>
          </div>
        </Form>
      ) : null}
    </div>
  );
}
