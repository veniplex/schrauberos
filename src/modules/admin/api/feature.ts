import { defineFeature } from "@/modules/define";

/**
 * API & Webhooks (Plattformfunktion der Verwaltung, nie abschaltbar): API-Tokens verwalten, Webhooks einrichten, Dokumentation der Programmierschnittstelle.
 * Die Schnittstelle selbst (`/api/v1`) und ihre Ressourcen gehören den Funktionen (`api.ts`); diese Funktion ist nur die Verwaltung dazu – sie ist **nie** selbst API-Ressource.
 * `api.manage` ist ein Verwaltungsrecht (adminOnly, in keiner Standardrolle): Tokens und Webhooks öffnen Daten nach außen.
 * Seiten unter `/admin/api` (nicht `/api`: dort liegen Route Handler mit eigener CSP und ohne Sitzung).
 */
export const apiAdminFeature = defineFeature({
  id: "api",
  module: "admin",
  nameKey: "api.feature.name",
  descriptionKey: "api.feature.description",
  required: true,
  order: 139,
  permissions: { group: "api", keys: ["api.manage"], adminOnly: ["api.manage"] },
  nav: [{ id: "api", href: "/admin/api", labelKey: "nav.api", icon: "api", permission: "api.manage", order: 137 }],
  routes: ["admin/api"],
  auditActions: ["webhook.create", "webhook.update", "webhook.delete", "webhook.test", "webhook.redeliver", "webhook.secret", "webhook.disabled"],
});
