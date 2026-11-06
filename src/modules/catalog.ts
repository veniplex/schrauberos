import { workshopModule } from "./workshop/module";
import { officeModule } from "./office/module";
import { itModule } from "./it/module";
import { adminModule } from "./admin/module";
import { appointmentsFeature } from "./workshop/appointments/feature";
import { tiresFeature } from "./workshop/tires/feature";
import { customersFeature } from "./workshop/customers/feature";
import { vehiclesFeature } from "./workshop/vehicles/feature";
import { workshopDocsFeature } from "./workshop/docs/feature";
import { invoicesFeature } from "./office/invoices/feature";
import { employeesFeature } from "./office/employees/feature";
import { fleetFeature } from "./office/fleet/feature";
import { officeDocsFeature } from "./office/docs/feature";
import { networkFeature } from "./it/network/feature";
import { itDocsFeature } from "./it/docs/feature";
import { usersFeature } from "./admin/users/feature";
import { rolesFeature } from "./admin/roles/feature";
import { settingsFeature } from "./admin/settings/feature";
import { modulesFeature } from "./admin/modules/feature";
import { auditFeature } from "./admin/audit/feature";
import { updatesFeature } from "./admin/updates/feature";
import { backupFeature } from "./admin/backup/feature";
import { featureKey } from "./catalog-logic";

/**
 * Der Katalog: alle Module und Funktionen der Anwendung – rein statisch (keine UI, keine DB).
 * Neue Funktion = feature.ts anlegen und hier eintragen. Alles andere (Rechte-Typen, Rechte-Gruppen,
 * Aktivierung, Admin-Seite) wird daraus abgeleitet.
 */
export const MODULES = [workshopModule, officeModule, itModule, adminModule] as const;

export const FEATURES = [
  appointmentsFeature,
  tiresFeature,
  customersFeature,
  vehiclesFeature,
  workshopDocsFeature,
  invoicesFeature,
  employeesFeature,
  fleetFeature,
  officeDocsFeature,
  networkFeature,
  itDocsFeature,
  usersFeature,
  rolesFeature,
  settingsFeature,
  modulesFeature,
  auditFeature,
  updatesFeature,
  backupFeature,
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];
export type FeatureDefinition = (typeof FEATURES)[number];
export type FeatureId = FeatureDefinition extends infer F ? (F extends { module: string; id: string } ? `${F["module"]}.${F["id"]}` : never) : never;
export type PermissionGroup = FeatureDefinition["permissions"]["group"];
export type Permission = FeatureDefinition["permissions"]["keys"][number];

export const MODULE_IDS = MODULES.map((m) => m.id) as readonly ModuleId[];

/** Rechte-Gruppen mit ihren Schlüsseln (je Funktion eine Gruppe). */
export const PERMISSION_GROUPS = Object.fromEntries(FEATURES.map((f) => [f.permissions.group, f.permissions.keys])) as unknown as Record<
  PermissionGroup,
  readonly Permission[]
>;

export const ALL_PERMISSIONS: Permission[] = FEATURES.flatMap((f) => [...f.permissions.keys]) as Permission[];

/** Zu welcher Funktion gehört ein Recht? */
const FEATURE_OF_PERMISSION = new Map<string, FeatureId>(
  FEATURES.flatMap((f) => f.permissions.keys.map((k) => [k, featureKey(f) as FeatureId] as const)),
);
export const featureOfPermission = (permission: string): FeatureId | undefined => FEATURE_OF_PERMISSION.get(permission);

export const isPermission = (value: string): value is Permission => FEATURE_OF_PERMISSION.has(value);

export const fullFeatureId = (f: { module: string; id: string }) => featureKey(f) as FeatureId;

export const featuresOfModule = (moduleId: string) => FEATURES.filter((f) => f.module === moduleId);

export const featureById = (id: string) => FEATURES.find((f) => featureKey(f) === id);

/** Rechte-Gruppen eines Moduls (für die Rollenverwaltung). */
export const groupsOfModule = (moduleId: string): PermissionGroup[] => featuresOfModule(moduleId).map((f) => f.permissions.group as PermissionGroup);

/** Funktionen, die die Querschnittsfunktion Dokumentation nutzen (Bereichs-ID → Funktion). */
export type DocFeature = Extract<FeatureDefinition, { docsArea: string }>;
export const DOC_FEATURES = FEATURES.filter((f): f is DocFeature => "docsArea" in f);
