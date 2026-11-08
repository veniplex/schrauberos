import "server-only";
import { getI18n } from "@/i18n/server";
import type { MaskSection, PreviewData, PreviewEntry } from "@/lib/role-mask";
import { FEATURES, MARKED_PERMISSIONS, MODULES, fullFeatureId, featuresOfModule, isAdminOnly, isExplicitOnly } from "@/modules/catalog";
import { getActiveFeatureIds } from "@/modules/features";
import { quickActionCatalog, widgetCatalog } from "@/modules/registry";
import { ROLE_TEMPLATES, templatePermissions } from "@/modules/role-templates";

/**
 * Rechte-Auswahl der Rollen-Maske: nach Modulen gegliedert, je Recht Name, Kurzbeschreibung (`permissionHints.*`) und Kennzeichnung (Regel 9: nur Administratoren, sensibel, Export …).
 * Rechte-Gruppen ausgeschalteter Funktionen werden markiert (`inactive`); das Formular klappt sie in einem eigenen Bereich ein.
 */
export async function permissionSections(): Promise<MaskSection[]> {
  const [{ t, td, has }, active] = await Promise.all([getI18n(), getActiveFeatureIds()]);
  // Ein Kennzeichen je Recht (Regel 9): „Nur Administratoren“ geht vor „Nur ausdrücklich“ geht vor die übrigen (Tresor: „Nur ausdrücklich“ statt „Anzeigen“/„Sensibel“ – der Katalog führt sie weiter unter `marked`)
  const markOf = (key: string): string | undefined => {
    if (isAdminOnly(key)) return t("roles.marks.adminOnly");
    if (isExplicitOnly(key)) return t("roles.marks.explicitOnly");
    const mark = MARKED_PERMISSIONS.get(key);
    return mark ? t(`roles.marks.${mark}`) : undefined;
  };
  return MODULES.map((m) => ({
    moduleId: m.id,
    moduleName: t(m.nameKey),
    groups: featuresOfModule(m.id).map((f) => ({
      group: f.permissions.group,
      label: td(`permissionGroups.${f.permissions.group}`, f.permissions.group),
      keys: f.permissions.keys.map((key) => {
        const [group, action] = key.split(".");
        return { key, label: td(`permissions.${key}`, key), hint: has(`permissionHints.${group}.${action}`) ? t(`permissionHints.${group}.${action}` as never) : "", mark: markOf(key) };
      }),
      inactive: !active.has(fullFeatureId(f)),
    })),
  })).filter((s) => s.groups.length > 0);
}

/**
 * Daten für die Vorschau „Was sieht diese Rolle?“: alle Navigationseinträge, Dashboard-Bausteine und Schnellaktionen mit Funktion und Recht, dazu die ausgeschalteten Funktionen.
 * Gerechnet wird im Formular (`rolePreview`) – es werden keine Seiten gerendert.
 */
export async function rolePreviewData(): Promise<PreviewData> {
  const [{ t }, active] = await Promise.all([getI18n(), getActiveFeatureIds()]);
  const moduleName = (id: string) => t(MODULES.find((m) => m.id === id)!.nameKey);
  const nav: PreviewEntry[] = FEATURES.flatMap((f) => f.nav.map((n) => ({ id: `${fullFeatureId(f)}:${n.id}`, feature: fullFeatureId(f), permission: n.permission, label: t(n.labelKey), moduleName: moduleName(f.module) })));
  const widgets: PreviewEntry[] = widgetCatalog().map((w) => ({ id: w.id, feature: w.feature, permission: w.permission, label: t(w.titleKey), moduleName: moduleName(w.module) }));
  const actions: PreviewEntry[] = quickActionCatalog().map((a) => ({ id: a.id, feature: a.feature, permission: a.permission, label: t(a.labelKey), moduleName: moduleName(a.module) }));
  return { nav, widgets, actions, inactiveFeatures: FEATURES.map(fullFeatureId).filter((id) => !active.has(id)) };
}

/** Rollenvorlagen mit übersetztem Namen und ihren Rechten (ohne Regel 9) – das Formular lässt gesperrte Rechte beim Übernehmen weg. */
export async function roleTemplates(): Promise<Array<{ id: string; name: string; description: string; permissions: string[] }>> {
  const { t } = await getI18n();
  return ROLE_TEMPLATES.map((template) => ({ id: template.id, name: t(template.nameKey), description: t(template.descriptionKey), permissions: templatePermissions(template) }));
}
