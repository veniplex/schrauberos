import { defineFeature } from "@/modules/define";

/**
 * Werkstattaufträge / Arbeitskarten (F2): Termin → Auftrag → (Rechnung, F3). Der Auftrag ist der Kern; Teile & Lager, Zeiterfassung, Checklisten, Dokumente und Rechnungen hängen sich
 * über die Erweiterungspunkte der Registry (Abschnitte der Auftragsseite, transaktionale Hooks auf `orders.close`/`orders.reopen`) an – `orders` kennt sie nicht.
 */
export const ordersFeature = defineFeature({
  id: "orders",
  module: "workshop",
  nameKey: "orders.feature.name",
  descriptionKey: "orders.feature.description",
  order: 15,
  defaultEnabled: false,
  requires: ["workshop.vehicles"],
  uses: ["workshop.appointments", "workshop.customers"],
  permissions: {
    group: "orders",
    keys: ["orders.view", "orders.create", "orders.edit", "orders.close", "orders.reopen", "orders.prices"],
    // Wieder öffnen hebt den Abschluss auf (Rückbuchungen, Audit): bewusst nie in einer Standardrolle (Regel 9)
    marked: { sensitive: ["orders.reopen"] },
  },
  nav: [{ id: "orders", href: "/orders", labelKey: "nav.orders", icon: "orders", permission: "orders.view", order: 15 }],
  quickActions: [
    { id: "orders.new", labelKey: "orders.quick.new", href: "/orders/new", icon: "orders", permission: "orders.create", order: 15 },
    { id: "orders.open", kind: "open", labelKey: "orders.quick.open", href: "/orders", icon: "orders", permission: "orders.view", order: 203 },
  ],
  routes: ["orders", "api/orders"],
  auditActions: [
    "orders.create",
    "orders.update",
    "orders.status",
    "orders.close",
    "orders.reopen",
    "orders.items",
    "orders.finding",
    "orders.findingRemove",
    "orders.approve",
  ],
});
