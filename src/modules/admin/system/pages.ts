import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("admin.system", [{ path: "/admin/system", kind: "other", permission: "system.view" }]);
