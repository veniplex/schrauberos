import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("workshop.appointments", [
  { path: "/appointments", kind: "list", permission: "appointments.view", key: true },
  { path: "/appointments", kind: "other", permission: "appointments.view", query: "?view=day" },
  { path: "/appointments", kind: "other", permission: "appointments.view", query: "?view=list" },
  { path: "/appointments", kind: "modal", permission: "appointments.create", query: "?new=1" },
  { path: "/appointments/[id]/slip", kind: "print", permission: "appointments.view", params: { id: { table: "Appointment" } } },
]);
