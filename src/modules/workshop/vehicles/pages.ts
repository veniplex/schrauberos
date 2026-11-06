import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("workshop.vehicles", [
  { path: "/vehicles", kind: "list", permission: "vehicles.view", key: true },
  { path: "/vehicles/new", kind: "new", permission: "vehicles.edit" },
  { path: "/vehicles/[id]", kind: "detail", permission: "vehicles.view", params: { id: { table: "Vehicle" } }, key: true },
  { path: "/vehicles/[id]/edit", kind: "edit", permission: "vehicles.edit", params: { id: { table: "Vehicle" } } },
  { path: "/vehicles/[id]", kind: "modal", permission: "vehicles.edit", params: { id: { table: "Vehicle" } }, query: "?transfer=1" },
]);
