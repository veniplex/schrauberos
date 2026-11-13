import { defineFeature } from "@/modules/define";

/**
 * Teile & Lager (F4): Artikel mit Bestand, Wareneingang, Inventur und Lagerbewegungen. Der Bestand wird **bei Auftragsabschluss** gebucht (Hook auf `orders.close`, gleiche Transaktion);
 * Kundenreifen (Reifenlager) sind keine Handelsware und bleiben abgegrenzt. Ohne Aufträge ist es ein reines Lager.
 */
export const partsFeature = defineFeature({
  id: "parts",
  module: "workshop",
  nameKey: "parts.feature.name",
  descriptionKey: "parts.feature.description",
  order: 25,
  defaultEnabled: false,
  uses: ["workshop.orders", "office.invoices"],
  permissions: { group: "parts", keys: ["parts.view", "parts.edit", "parts.stock", "parts.prices"] },
  nav: [{ id: "parts", href: "/parts", labelKey: "nav.parts", icon: "parts", permission: "parts.view", order: 25 }],
  quickActions: [
    { id: "parts.receipt", labelKey: "parts.quick.receipt", href: "/parts/receipt", icon: "parts", permission: "parts.stock", order: 25 },
    { id: "parts.list", kind: "open", labelKey: "parts.quick.list", href: "/parts", icon: "parts", permission: "parts.view", order: 204 },
  ],
  routes: ["parts", "api/parts"],
  auditActions: ["part.create", "part.update", "part.archive", "part.unarchive", "part.receipt", "part.count"],
});
