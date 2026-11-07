import { defineFeature } from "@/modules/define";

/**
 * Angebote & Rechnungserstellung (F3): Angebot, Auftragsbestätigung, Rechnung, Teil-/Abschlags- und Schlussrechnung, Stornorechnung – mit Positionen, Steuer (19/7/0 %, Kleinunternehmer § 19 UStG),
 * fortlaufender Nummer erst beim Festschreiben, Schnappschuss von Absender und Empfänger, Zahlungen, PDF (mit Girocode), XRechnung und Versand per E-Mail.
 * Rechnungen landen in derselben Ausgangsliste (`office.invoices`) wie von Hand erfasste – es gibt keinen zweiten Bestand. Festschreiben bleibt das vorhandene Recht `invoices.finalize`,
 * Zahlungen und Storno bleiben `invoices.edit` (P4b-3); neu sind das Bearbeiten von Entwürfen, das Annehmen von Angeboten und der Versand (gekennzeichnet, in keiner Standardrolle).
 */
export const billingFeature = defineFeature({
  id: "billing",
  module: "office",
  nameKey: "billing.feature.name",
  descriptionKey: "billing.feature.description",
  order: 31,
  defaultEnabled: false,
  requires: ["office.invoices"],
  uses: ["workshop.orders", "workshop.customers", "workshop.vehicles", "workshop.parts"],
  permissions: {
    group: "billing",
    keys: ["billing.view", "billing.edit", "billing.accept", "billing.send"],
    // Versand per E-Mail geht an Kunden hinaus: bewusst nie in einer Standardrolle (Regel 9)
    marked: { send: ["billing.send"] },
  },
  nav: [{ id: "billing", href: "/billing", labelKey: "nav.billing", icon: "invoices", permission: "billing.view", order: 31 }],
  quickActions: [
    { id: "billing.newOffer", labelKey: "billing.quick.newOffer", href: "/billing/new?type=offer", icon: "invoices", permission: "billing.edit", order: 90 },
    { id: "billing.newInvoice", labelKey: "billing.quick.newInvoice", href: "/billing/new?type=invoice", icon: "invoices", permission: "billing.edit", order: 91 },
  ],
  routes: ["billing", "api/billing"],
  // Ereignisse für Webhooks (nur Typ und ID; der Empfänger holt den Beleg über die API)
  webhookEvents: [
    { type: "billing.finalized", resource: "billing-documents" },
    { type: "billing.accepted", resource: "billing-documents" },
    { type: "billing.paid", resource: "billing-documents" },
    { type: "billing.sent", resource: "billing-documents" },
    { type: "billing.cancelled", resource: "billing-documents" },
  ],
  auditActions: [
    "billing.create",
    "billing.update",
    "billing.delete",
    "billing.issue",
    "billing.finalize",
    "billing.accept",
    "billing.reject",
    "billing.confirmation",
    "billing.toOrder",
    "billing.fromOrder",
    "billing.payment",
    "billing.paymentRemove",
    "billing.send",
  ],
});
