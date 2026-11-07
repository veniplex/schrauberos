import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“). */
export const pages = definePages("workshop.files", [{ path: "/files", kind: "list", permission: "files.view", key: true }]);
