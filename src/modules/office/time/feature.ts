import { defineFeature } from "@/modules/define";

/**
 * Zeiterfassung (F5): Stempeln auf Aufträge oder allgemein, Zeiteinträge mit Arbeitswerten, Pausen-/Ruhezeit-Hinweise, Korrektur nur mit Begründung und Verlauf, Wochenübersicht Ist/Soll/Saldo.
 * Die Funktion braucht die Mitarbeiterverwaltung (wer stempelt, ist über das Konto bekannt; Arbeitstage und Abwesenheit liefert sie) und nutzt Aufträge nur weich (Abschnitt „Zeiten“, Übernahme als Positionen).
 */
export const timeFeature = defineFeature({
  id: "time",
  module: "office",
  nameKey: "time.feature.name",
  descriptionKey: "time.feature.description",
  order: 45,
  defaultEnabled: false,
  requires: ["office.employees"],
  uses: ["workshop.orders"],
  permissions: {
    group: "time",
    keys: ["time.view", "time.stamp", "time.correct", "time.viewAll", "time.correctAll"],
    // Zeiten aller Mitarbeiter sind personenbezogen (Anwesenheit, Arbeitszeit): bewusst nie in einer Standardrolle (Regel 9)
    marked: { sensitive: ["time.viewAll", "time.correctAll"] },
  },
  nav: [{ id: "time", href: "/time", labelKey: "nav.time", icon: "time", permission: "time.view", order: 45 }],
  quickActions: [
    { id: "time.open", kind: "open", labelKey: "time.quick.open", href: "/time", icon: "time", permission: "time.view", order: 210 },
  ],
  routes: ["time"],
  auditActions: ["time.start", "time.stop", "time.correct", "time.void", "time.manual", "time.transfer", "settings.time"],
});
