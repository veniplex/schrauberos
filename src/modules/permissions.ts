// Zentrale Liste aller Berechtigungen, gruppiert nach Modul – und die Module wiederum nach Bereich.
// Neues Modul/Feature => neue Gruppe hier eintragen UND einem Bereich zuordnen; sie erscheinen
// automatisch in der Rollenverwaltung. Beschriftungen: i18n `permissions.<gruppe>.<aktion>`
// und `permissionGroups.<gruppe>`.
export const PERMISSION_GROUPS = {
  // Werkstatt
  appointments: ["appointments.view", "appointments.create", "appointments.edit", "appointments.delete"],
  tires: ["tires.view", "tires.create", "tires.edit", "tires.delete"],
  customers: ["customers.view", "customers.edit", "customers.delete"],
  docsWorkshop: ["docsWorkshop.view", "docsWorkshop.edit"],
  // Büro
  invoices: ["invoices.view", "invoices.edit", "invoices.delete"],
  employees: ["employees.view", "employees.edit", "employees.delete", "employees.sensitive"],
  fleet: ["fleet.view", "fleet.edit", "fleet.delete"],
  docsOffice: ["docsOffice.view", "docsOffice.edit"],
  // IT
  network: ["network.view", "network.edit", "network.delete"],
  docsIt: ["docsIt.view", "docsIt.edit"],
  // Verwaltung
  users: ["users.view", "users.manage"],
  roles: ["roles.manage"],
  settings: ["settings.manage"],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type Permission = (typeof PERMISSION_GROUPS)[PermissionGroup][number];

export type Area = "workshop" | "office" | "it" | "admin";

/** Bereiche der Anwendung mit ihren Rechte-Gruppen (Reihenfolge = Anzeige in der Rollenverwaltung). */
export const PERMISSION_AREAS: Record<Area, readonly PermissionGroup[]> = {
  workshop: ["appointments", "tires", "customers", "docsWorkshop"],
  office: ["invoices", "employees", "fleet", "docsOffice"],
  it: ["network", "docsIt"],
  admin: ["users", "roles", "settings"],
};

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSION_GROUPS).flat() as Permission[];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

/**
 * Standardrollen, die beim Seeden angelegt werden (Admin = alle Rechte, immer).
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
    description: "Voller Zugriff auf alle Funktionen, inkl. Benutzer- und Rollenverwaltung.",
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
      "appointments.view", "tires.view", "customers.view", "docsWorkshop.view",
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
      "docsWorkshop.view",
    ],
  },
  {
    key: "mechanic",
    name: "Mechaniker",
    description: "Termine einsehen und Status pflegen, Reifenlager einsehen, Werkstatt-Dokumentation lesen.",
    permissions: ["appointments.view", "appointments.edit", "tires.view", "customers.view", "docsWorkshop.view"],
  },
  {
    key: "warehouse",
    name: "Lager",
    description: "Reifenlager pflegen.",
    permissions: ["tires.view", "tires.create", "tires.edit", "tires.delete", "customers.view", "appointments.view", "docsWorkshop.view"],
  },
  {
    key: "it_admin",
    name: "IT-Administrator",
    description: "Netzwerk dokumentieren und die IT-Dokumentation pflegen.",
    permissions: ["network.view", "network.edit", "network.delete", "docsIt.view", "docsIt.edit"],
  },
];
