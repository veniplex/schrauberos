import { defineFeature } from "@/modules/define";

/**
 * Berichte (F9): Umsatz je Monat, offene Posten, Auslastung je Arbeitsplatz, Einlagerungsbestand und Fälligkeiten – **nur lesend**, mit Diagramm und Tabelle (und CSV-Export mit eigenem Recht). Die Daten
 * kommen aus den Quellfunktionen (Rechnungen, Termine, Reifenlager, Fahrzeuge, Fuhrpark); ein Bericht zeigt nie, was die Person an der Quelle nicht sehen darf: `reports.view` **plus** das Leserecht der
 * Quelle (`access.ts`). Keine harte Abhängigkeit – jede Quelle ist weich (`uses`), ein Bericht erscheint nur, wenn seine Quelle aktiv ist.
 */
export const reportsFeature = defineFeature({
  id: "reports",
  module: "office",
  nameKey: "reports.feature.name",
  descriptionKey: "reports.feature.description",
  order: 32,
  defaultEnabled: false,
  uses: ["office.invoices", "office.billing", "workshop.appointments", "workshop.tires", "workshop.vehicles", "office.fleet", "workshop.customers"],
  permissions: {
    group: "reports",
    keys: ["reports.view", "reports.export"],
    // CSV-Export von Auswertungen (Umsätze, offene Posten mit Geschäftspartnern): bewusst nie in einer Standardrolle (Regel 9)
    marked: { export: ["reports.export"] },
  },
  nav: [{ id: "reports", href: "/reports", labelKey: "nav.reports", icon: "reports", permission: "reports.view", order: 32 }],
  routes: ["reports"],
  auditActions: ["reports.export"],
});
