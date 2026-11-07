import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): der Reiter „E-Mail“ der Einstellungen. */
export const pages = definePages("admin.mail", [{ path: "/settings", kind: "other", permission: "mail.manage", query: "?tab=mail" }]);
