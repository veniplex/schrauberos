import type { Permission } from "./catalog";

/**
 * Standardrollen, die beim Seeden angelegt werden (Administrator = alle Rechte, immer).
 * Bereits vorhandene Rollen werden nie überschrieben – Anpassungen bleiben erhalten.
 */
export const DEFAULT_ROLES: Array<{
  key: string;
  name: string;
  description: string;
  isAdmin?: boolean;
  permissions: Permission[];
}> = [
  {
    key: "admin",
    name: "Administrator",
    description: "Voller Zugriff auf alle Funktionen, inkl. Benutzer-, Rollen- und Modulverwaltung.",
    isAdmin: true,
    permissions: [],
  },
  {
    key: "management",
    name: "Geschäftsführung",
    description: "Büro-Bereich vollständig, Werkstatt lesend.",
    permissions: [
      "invoices.view", "invoices.edit", "invoices.delete",
      // Angebote & Rechnungen: ansehen, Entwürfe bearbeiten, Angebote annehmen; Festschreiben (invoices.finalize) und Versand (billing.send) sind gekennzeichnet (Regel 9) und in keiner Standardrolle
      "billing.view", "billing.edit", "billing.accept",
      // Berichte ansehen (jeder Bericht zeigt nur, was die Rolle auch an der Quelle sehen darf); der CSV-Export (reports.export) ist gekennzeichnet (Regel 9) und in keiner Standardrolle
      "reports.view",
      "employees.view", "employees.edit", "employees.delete", "employees.sensitive",
      "fleet.view", "fleet.edit", "fleet.delete",
      "handbook.view", "handbook.edit",
      "appointments.view", "tires.view", "customers.view", "vehicles.view",
      "orders.view", "orders.prices",
      "parts.view", "parts.prices",
      // Zeiterfassung: eigene Zeiten stempeln, ansehen und korrigieren; `time.viewAll`/`time.correctAll` sind gekennzeichnet (personenbezogen, Regel 9) und gehören in keine Standardrolle
      "time.view", "time.stamp", "time.correct",
      "files.view", "files.delete",
      // Checklisten ansehen und Vorlagen pflegen (die Leitung); ausfüllen tun die Werkstattrollen
      "checklists.view", "checklists.manage",
    ],
  },
  {
    key: "office",
    name: "Büro / Verwaltung",
    description: "Rechnungen, Mitarbeiter (ohne sensible Daten), Fuhrpark und Handbuch (lesen und schreiben).",
    permissions: [
      "invoices.view", "invoices.edit",
      "billing.view", "billing.edit", "billing.accept",
      "reports.view",
      "employees.view",
      "fleet.view", "fleet.edit",
      "handbook.view", "handbook.edit",
      "customers.view", "appointments.view",
      "orders.view", "orders.prices",
      "time.view", "time.stamp", "time.correct",
    ],
  },
  {
    key: "advisor",
    name: "Serviceberater",
    description: "Kunden, Fahrzeuge, Termine und Reifenlager verwalten.",
    permissions: [
      "appointments.view", "appointments.create", "appointments.edit", "appointments.delete",
      "tires.view", "tires.create", "tires.edit", "tires.stock",
      "customers.view", "customers.edit",
      "vehicles.view", "vehicles.edit",
      // Aufträge: annehmen, bearbeiten, Preise erfassen und abschließen; „Wieder öffnen“ (orders.reopen) ist gekennzeichnet (Regel 9) und gehört in keine Standardrolle
      "orders.view", "orders.create", "orders.edit", "orders.close", "orders.prices",
      "parts.view", "parts.prices",
      // Angebote erstellen und annehmen: Teil der Annahme (Rechnungen festschreiben und versenden darf der Serviceberater nicht)
      "billing.view", "billing.edit", "billing.accept",
      "time.view", "time.stamp", "time.correct",
      // Dokumente & Fotos: hochladen und – als Leitung der Annahme – auch fremde Dateien entfernen
      "files.view", "files.upload", "files.delete",
      "checklists.view", "checklists.fill",
      "handbook.view",
    ],
  },
  {
    key: "mechanic",
    name: "Mechaniker",
    description: "Termine einsehen und Status pflegen, Reifensätze ein-/ausbuchen, Reifenlager und Fahrzeuge einsehen, Handbuch lesen.",
    // `tires.stock` (Ein-/Ausbuchen) gehört ausdrücklich dazu: Wer den Wechsel am Fahrzeug macht, bucht den Satz um (Vorschlag nach dem erledigten Termin). Das ist kein
    // sensibles/Export-/Verwaltungsrecht (Regel 9) und gibt nicht das Bearbeiten (`tires.edit`) oder Löschen von Sätzen frei.
    // Aufträge: ansehen und bearbeiten (Status, Befunde) – bewusst ohne `orders.prices`: Preise und Summen bekommen Mechaniker nicht zu sehen und werden für sie nicht gelesen
    permissions: ["appointments.view", "appointments.edit", "tires.view", "tires.stock", "customers.view", "vehicles.view", "orders.view", "orders.edit", "parts.view", "time.view", "time.stamp", "time.correct", "files.view", "files.upload", "checklists.view", "checklists.fill", "handbook.view"],
  },
  {
    key: "warehouse",
    name: "Lager",
    description: "Reifenlager pflegen.",
    // Teile & Lager: das Lager pflegt Artikel, bucht Wareneingang und Inventur und sieht die Preise (Mechaniker nicht)
    permissions: ["tires.view", "tires.create", "tires.edit", "tires.stock", "tires.delete", "customers.view", "vehicles.view", "appointments.view", "parts.view", "parts.edit", "parts.stock", "parts.prices", "time.view", "time.stamp", "time.correct", "files.view", "files.upload", "handbook.view"],
  },
  {
    key: "it_admin",
    name: "IT-Administrator",
    description: "Netzwerk dokumentieren und die IT-Dokumentation pflegen.",
    permissions: ["network.view", "network.edit", "network.delete", "docsIt.view", "docsIt.edit", "handbook.view"],
  },
];
