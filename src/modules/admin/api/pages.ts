import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): Übersicht mit Tokens, Webhooks, Doku-Seite. Das JSON der Beschreibung (`/admin/api/openapi.json`) ist ein Route Handler. */
export const pages = definePages("admin.api", [
  { path: "/admin/api", kind: "list", permission: "api.manage", key: true },
  { path: "/admin/api/tokens/new", kind: "new", permission: "api.manage" },
  { path: "/admin/api/webhooks", kind: "list", permission: "api.manage" },
  { path: "/admin/api/webhooks/new", kind: "new", permission: "api.manage" },
  { path: "/admin/api/webhooks/[id]", kind: "detail", permission: "api.manage", params: { id: { table: "Webhook" } } },
  { path: "/admin/api/docs", kind: "other", permission: "api.manage", key: true },
]);
