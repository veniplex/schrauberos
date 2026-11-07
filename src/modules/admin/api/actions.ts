"use server";

import { formObject } from "@/lib/forms";
import { createApiTokenOperation, revokeApiTokenOperation } from "@/server/api/tokens";
import { defineAction } from "@/server/operations";
import { deleteWebhookOperation, redeliverOperation, rotateWebhookSecretOperation, saveWebhookOperation, setWebhookEnabledOperation, testWebhookOperation } from "./operations";

const flag = (fd: FormData, name: string) => fd.get(name) === "on";

/**
 * Token anlegen (Passwortabfrage in der Operation). Der Klartext steht **nur in der Antwort der Aktion** (`state`) und wird im Formular einmalig angezeigt – nie in URL, Log, Audit oder Datenbank.
 * Der Scope kommt als Mehrfachfeld `scope`; „Rechte mit Kennzeichnung bestätigt“ als Häkchen.
 */
export const createApiToken = defineAction(createApiTokenOperation, {
  form: (fd) => ({
    ...formObject(fd),
    scope: fd.getAll("scope").map(String),
    acknowledgeMarked: flag(fd, "acknowledgeMarked"),
    // Passwörter nie kürzen
    password: String(fd.get("password") ?? ""),
  }),
  revalidate: ["/admin/api"],
  message: "api.tokens.created",
  state: (data, _input, { date }) => ({ token: { value: data.token, hint: data.hint, expiresOn: date(data.expiresAt, { dateStyle: "medium" }) } }),
});

export const revokeApiToken = defineAction(revokeApiTokenOperation, { revalidate: ["/admin/api"], message: "api.tokens.revoked" });

/** Webhook speichern (Formular mit oder ohne `id`). Beim **Anlegen** steht das Geheimnis einmalig im Zustand der Antwort (nie in einer Adresse). */
export const saveWebhook = defineAction(saveWebhookOperation, {
  form: (fd) => ({
    ...formObject(fd),
    events: fd.getAll("events").map(String),
    enabled: flag(fd, "enabled"),
    allowPrivate: flag(fd, "allowPrivate"),
  }),
  revalidate: ["/admin/api/webhooks", ["/admin/api/webhooks/[id]", "page"]],
  message: "api.webhooks.saved",
  state: (data) => (data.secret ? { created: { id: data.id, secret: data.secret } } : {}),
});

export const setWebhookEnabled = defineAction(setWebhookEnabledOperation, {
  form: (fd) => ({ id: String(fd.get("id") ?? ""), enabled: fd.get("enabled") === "true" }),
  revalidate: ["/admin/api/webhooks", ["/admin/api/webhooks/[id]", "page"]],
  message: "api.webhooks.saved",
});

export const deleteWebhook = defineAction(deleteWebhookOperation, { revalidate: ["/admin/api/webhooks"], redirect: "/admin/api/webhooks", message: "api.webhooks.deleted" });

/** Neues Geheimnis: einmalig im Zustand der Antwort. */
export const rotateWebhookSecret = defineAction(rotateWebhookSecretOperation, {
  revalidate: [["/admin/api/webhooks/[id]", "page"]],
  state: (data) => ({ secret: data.secret, overlapHours: data.overlapHours }),
});

/** Test-Ereignis: Meldung nennt das Ergebnis (Statuscode oder Fehlercode). */
export const testWebhook = defineAction(testWebhookOperation, {
  revalidate: ["/admin/api/webhooks", ["/admin/api/webhooks/[id]", "page"]],
  state: (data) => ({ test: { outcome: data.outcome, status: data.status, error: data.error, durationMs: data.durationMs } }),
});

export const redeliver = defineAction(redeliverOperation, { revalidate: ["/admin/api/webhooks", ["/admin/api/webhooks/[id]", "page"]], message: "api.webhooks.redelivered" });
