import { defineFeature } from "@/modules/define";

/**
 * Checklisten (F7): versionierte Vorlagen (Annahmeprotokoll, Ölwechsel, Reifenwechsel mit Drehmoment, HU-Vorbereitung und eigene), Punkte mit Haken, Messwert, Drehmoment, Auswahl, Text und Foto-Hinweis,
 * Kundenunterschrift am Touchscreen, unveränderlich nach dem Abschluss. Das **Annahmeprotokoll hat hier seinen einzigen Eigentümer**; der Druck (F8) liest es über `public.ts`.
 * Fahrzeuge brauchen die Funktion hart, Aufträge nur weich (Abschnitt am Auftrag, „Annahmeprotokoll starten“).
 */
export const checklistsFeature = defineFeature({
  id: "checklists",
  module: "workshop",
  nameKey: "checklists.feature.name",
  descriptionKey: "checklists.feature.description",
  order: 26,
  defaultEnabled: false,
  requires: ["workshop.vehicles"],
  uses: ["workshop.orders", "workshop.customers"],
  permissions: {
    group: "checklists",
    keys: ["checklists.view", "checklists.fill", "checklists.manage", "checklists.reopen"],
    // Wieder öffnen hebt die Unveränderlichkeit eines (vom Kunden unterschriebenen) Protokolls auf – wie orders.reopen bewusst nie in einer Standardrolle (Regel 9); Vorlagen pflegen bleibt Sache der Leitung
    marked: { sensitive: ["checklists.reopen"] },
  },
  nav: [{ id: "checklists", href: "/checklists", labelKey: "nav.checklists", icon: "checklists", permission: "checklists.view", order: 26 }],
  quickActions: [
    { id: "checklists.open", kind: "open", labelKey: "checklists.quick.open", href: "/checklists", icon: "checklists", permission: "checklists.view", order: 207 },
  ],
  routes: ["checklists", "api/checklists"],
  auditActions: ["checklists.templateCreate", "checklists.templateUpdate", "checklists.templateArchive", "checklists.start", "checklists.complete", "checklists.reopen", "checklists.discard"],
});
