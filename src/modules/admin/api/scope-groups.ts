import { MARKED_PERMISSIONS, FEATURES, featureOfPermission, featureById, type PermissionGroup } from "@/modules/catalog";
import type { Translator } from "@/i18n/translate";
import type { ScopeGroup } from "./token-form";

/**
 * Auswahl der Rechte für ein neues Token: je Funktion eine Gruppe, darin nur Rechte, die die Schnittstelle nutzt, die ein Token tragen darf (`apiGrantablePermissions`: nie Verwaltung, nie sensible
 * Mitarbeiterdaten, nie Datenaustausch) und die die handelnde Person selbst hat (Rechte-Hierarchie). **Lesen und Schreiben/Löschen sind einzelne Rechte** – nichts ist vorgewählt.
 */
export function scopeGroups(grantable: readonly string[], can: (permission: string) => boolean, { td }: Pick<Translator, "td">): ScopeGroup[] {
  const byFeature = new Map<string, string[]>();
  for (const permission of grantable) {
    if (!can(permission)) continue;
    const feature = featureOfPermission(permission);
    if (feature) byFeature.set(feature, [...(byFeature.get(feature) ?? []), permission]);
  }
  return FEATURES.flatMap((f) => {
    const id = `${f.module}.${f.id}`;
    const keys = byFeature.get(id);
    const group = f.permissions.group as PermissionGroup;
    if (!keys || !featureById(id)) return [];
    return [
      {
        id,
        label: td(`permissionGroups.${group}`, group),
        items: [...keys]
          .sort((a, b) => Number(b.endsWith(".view")) - Number(a.endsWith(".view")) || a.localeCompare(b))
          .map((key) => {
            const action = key.slice(group.length + 1);
            return {
              key,
              label: td(`permissions.${group}.${action}`, key),
              hint: td(`permissionHints.${group}.${action}`, "") || undefined,
              read: key.endsWith(".view"),
              mark: MARKED_PERMISSIONS.get(key),
            };
          }),
      },
    ];
  });
}
