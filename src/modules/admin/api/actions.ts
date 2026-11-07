"use server";

import { formObject } from "@/lib/forms";
import { createServiceAccountOperation, deleteServiceAccountOperation, setServiceAccountActiveOperation } from "@/server/api/service-accounts";
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
    // Besitzer: leer = das eigene Konto
    ownerId: String(fd.get("ownerId") ?? "") || undefined,
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
    // Passwörter nie kürzen
    password: String(fd.get("password") ?? ""),
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
  form: (fd) => ({ id: String(fd.get("id") ?? ""), password: String(fd.get("password") ?? "") }),
  revalidate: [["/admin/api/webhooks/[id]", "page"]],
  state: (data) => ({ secret: data.secret, overlapHours: data.overlapHours }),
});

/** Test-Ereignis: Meldung nennt das Ergebnis (Statuscode oder Fehlercode). */
export const testWebhook = defineAction(testWebhookOperation, {
  revalidate: ["/admin/api/webhooks", ["/admin/api/webhooks/[id]", "page"]],
  state: (data) => ({ test: { outcome: data.outcome, status: data.status, error: data.error, durationMs: data.durationMs } }),
});

export const redeliver = defineAction(redeliverOperation, { revalidate: ["/admin/api/webhooks", ["/admin/api/webhooks/[id]", "page"]], message: "api.webhooks.redelivered" });

/** Dienstkonto anlegen (Passwortabfrage in der Operation); Rollen als Mehrfachfeld `roleId`. */
export const createServiceAccount = defineAction(createServiceAccountOperation, {
  form: (fd) => ({ name: String(fd.get("name") ?? ""), roleIds: [...new Set(fd.getAll("roleId").map(String))], password: String(fd.get("password") ?? "") }),
  revalidate: ["/admin/api/accounts"],
  redirect: "/admin/api/accounts",
  message: "api.accounts.created",
});

export const setServiceAccountActive = defineAction(setServiceAccountActiveOperation, {
  form: (fd) => ({ id: String(fd.get("id") ?? ""), active: fd.get("active") === "true", password: String(fd.get("password") ?? "") }),
  revalidate: ["/admin/api/accounts", "/admin/api"],
  message: (data, input) => (input.active ? "api.accounts.enabled" : "api.accounts.disabled"),
});

export const deleteServiceAccount = defineAction(deleteServiceAccountOperation, { revalidate: ["/admin/api/accounts", "/admin/api"], message: "api.accounts.deleted" });
