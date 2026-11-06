import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("office.fleet", [
  { path: "/fleet", kind: "list", permission: "fleet.view" },
  { path: "/fleet/new", kind: "new", permission: "fleet.edit" },
  { path: "/fleet/[id]", kind: "detail", permission: "fleet.view", params: { id: { table: "FleetVehicle" } } },
  { path: "/fleet/[id]/edit", kind: "edit", permission: "fleet.edit", params: { id: { table: "FleetVehicle" } } },
  { path: "/fleet/licenses", kind: "other", permission: "fleet.view" },
]);
