import "server-only";
import { getI18n } from "@/i18n/server";
import { MODULES, fullFeatureId, featuresOfModule } from "@/modules/catalog";
import { getActiveFeatureIds } from "@/modules/features";
import type { RolePermissionSection } from "./forms";

/** Rechte-Auswahl der Rollen-Maske: nach Modulen gegliedert, Rechte-Gruppen ausgeschalteter Funktionen werden markiert. */
export async function permissionSections(): Promise<RolePermissionSection[]> {
  const [{ t, td }, active] = await Promise.all([getI18n(), getActiveFeatureIds()]);
  return MODULES.map((m) => ({
    moduleId: m.id,
    moduleName: t(m.nameKey),
    groups: featuresOfModule(m.id).map((f) => ({
      group: f.permissions.group,
      label: td(`permissionGroups.${f.permissions.group}`, f.permissions.group),
      keys: f.permissions.keys.map((key) => ({ key, label: td(`permissions.${key}`, key) })),
      inactive: !active.has(fullFeatureId(f)),
    })),
  })).filter((s) => s.groups.length > 0);
}
