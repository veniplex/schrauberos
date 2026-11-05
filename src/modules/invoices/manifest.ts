import type { ModuleManifest } from "../types";
import { InvoicesWidget } from "./widgets";

/** Büro: Rechnungsarchiv (Eingang/Ausgang) mit Zahlungsstatus und Dateien. */
export const invoicesModule: ModuleManifest = {
  id: "invoices",
  nav: [{ id: "invoices", href: "/invoices", labelKey: "nav.invoices", icon: "invoices", permission: "invoices.view", section: "office", order: 30 }],
  widgets: [{ id: "invoices-open", permission: "invoices.view", area: "office", span: 1, order: 39, Component: InvoicesWidget }],
};
