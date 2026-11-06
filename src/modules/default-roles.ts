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
      "employees.view", "employees.edit", "employees.delete", "employees.sensitive",
      "fleet.view", "fleet.edit", "fleet.delete",
      "docsOffice.view", "docsOffice.edit",
      "appointments.view", "tires.view", "customers.view", "vehicles.view", "docsWorkshop.view",
    ],
  },
  {
    key: "office",
    name: "Büro / Verwaltung",
    description: "Rechnungen, Mitarbeiter (ohne sensible Daten), Fuhrpark und Büro-Dokumentation.",
    permissions: [
      "invoices.view", "invoices.edit",
      "employees.view",
      "fleet.view", "fleet.edit",
      "docsOffice.view", "docsOffice.edit",
      "customers.view", "appointments.view",
    ],
  },
  {
    key: "advisor",
    name: "Serviceberater",
    description: "Kunden, Fahrzeuge, Termine und Reifenlager verwalten.",
    permissions: [
      "appointments.view", "appointments.create", "appointments.edit", "appointments.delete",
      "tires.view", "tires.create", "tires.edit",
      "customers.view", "customers.edit",
      "vehicles.view", "vehicles.edit",
      "docsWorkshop.view",
    ],
  },
  {
    key: "mechanic",
    name: "Mechaniker",
    description: "Termine einsehen und Status pflegen, Reifenlager und Fahrzeuge einsehen, Werkstatt-Dokumentation lesen.",
    permissions: ["appointments.view", "appointments.edit", "tires.view", "customers.view", "vehicles.view", "docsWorkshop.view"],
  },
  {
    key: "warehouse",
    name: "Lager",
    description: "Reifenlager pflegen.",
    permissions: ["tires.view", "tires.create", "tires.edit", "tires.delete", "customers.view", "vehicles.view", "appointments.view", "docsWorkshop.view"],
  },
  {
    key: "it_admin",
    name: "IT-Administrator",
    description: "Netzwerk dokumentieren und die IT-Dokumentation pflegen.",
    permissions: ["network.view", "network.edit", "network.delete", "docsIt.view", "docsIt.edit"],
  },
];
