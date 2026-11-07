import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("workshop.tires", [
  { path: "/tires", kind: "list", permission: "tires.view", key: true },
  { path: "/tires/export", kind: "other", permission: "tires.export" },
  { path: "/tires/import", kind: "other", permission: "tires.import" },
  { path: "/tires/new", kind: "new", permission: "tires.create" },
  { path: "/tires/[id]", kind: "detail", permission: "tires.view", params: { id: { table: "TireSet" } }, key: true },
  { path: "/tires/[id]/label", kind: "print", permission: "tires.view", params: { id: { table: "TireSet" } } },
  { path: "/tires/[id]/edit", kind: "edit", permission: "tires.edit", params: { id: { table: "TireSet" } } },
]);
