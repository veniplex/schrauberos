import { defineFeature } from "@/modules/define";

/**
 * Dokumente & Fotos (F6): Dateien und Fotos an Fahrzeugen und Aufträgen. Der Zugriff folgt den Rechten der Entität (Fahrzeug: `vehicles.view`, Auftrag: `orders.view`), Kunden mit eingeschränkter
 * Verarbeitung (Art. 18) sind ausgeschlossen. Hochgeladene Fotos werden serverseitig bereinigt (Exif/GPS entfernt, Pixelgrenze), die Auslieferung läuft nur über eine Route mit Rechteprüfung (`sandbox`).
 * Fahrzeuge brauchen die Funktion hart, Aufträge nur weich.
 */
export const filesFeature = defineFeature({
  id: "files",
  module: "workshop",
  nameKey: "files.feature.name",
  descriptionKey: "files.feature.description",
  order: 25,
  defaultEnabled: false,
  requires: ["workshop.vehicles"],
  uses: ["workshop.orders", "workshop.customers"],
  permissions: { group: "files", keys: ["files.view", "files.upload", "files.delete"] },
  nav: [{ id: "files", href: "/files", labelKey: "nav.files", icon: "files", permission: "files.view", order: 25 }],
  quickActions: [{ id: "files.open", kind: "open", labelKey: "files.quick.open", href: "/files", icon: "files", permission: "files.view", order: 206 }],
  routes: ["files", "api/files"],
  webhookEvents: [{ type: "file.uploaded", resource: "files" }],
  auditActions: ["file.upload", "file.update", "file.archive"],
});
