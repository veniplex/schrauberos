// Zentrale Liste aller Berechtigungen, gruppiert nach Modul.
// Neues Modul/Feature => neue Gruppe oder neue Schlüssel hier eintragen; sie erscheinen
// automatisch in der Rollenverwaltung. Beschriftungen: i18n `permissions.<gruppe>.<aktion>`
// und `permissionGroups.<gruppe>`.
export const PERMISSION_GROUPS = {
  appointments: ["appointments.view", "appointments.create", "appointments.edit", "appointments.delete"],
  tires: ["tires.view", "tires.create", "tires.edit", "tires.delete"],
  customers: ["customers.view", "customers.edit", "customers.delete"],
  users: ["users.view", "users.manage"],
  roles: ["roles.manage"],
  settings: ["settings.manage"],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type Permission = (typeof PERMISSION_GROUPS)[PermissionGroup][number];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSION_GROUPS).flat() as Permission[];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

/** Standardrollen, die beim Seeden angelegt werden (Admin = alle Rechte, immer). */
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
    key: "advisor",
    name: "Serviceberater",
    description: "Kunden, Termine und Reifenlager verwalten.",
    permissions: [
      "appointments.view", "appointments.create", "appointments.edit", "appointments.delete",
      "tires.view", "tires.create", "tires.edit",
      "customers.view", "customers.edit",
    ],
  },
  {
    key: "mechanic",
    name: "Mechaniker",
    description: "Termine einsehen und Status pflegen, Reifenlager einsehen.",
    permissions: ["appointments.view", "appointments.edit", "tires.view", "customers.view"],
  },
  {
    key: "warehouse",
    name: "Lager",
    description: "Reifenlager pflegen.",
    permissions: ["tires.view", "tires.create", "tires.edit", "tires.delete", "customers.view", "appointments.view"],
  },
];
