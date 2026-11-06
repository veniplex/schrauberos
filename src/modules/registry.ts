import type { MessageKey } from "@/i18n/translate";
import type { AppSession } from "@/server/auth/session";
import { FEATURES, MODULES, fullFeatureId, type FeatureId, type ModuleId } from "./catalog";
import type { IconName } from "./define";
import type { SettingsTabDef, WidgetDef } from "./types";

import { widgets as appointmentsWidgets } from "./workshop/appointments/widgets";
import { settingsTabs as appointmentsSettings } from "./workshop/appointments/settings-tab";
import { widgets as tiresWidgets } from "./workshop/tires/widgets";
import { settingsTabs as tiresSettings } from "./workshop/tires/settings-tab";
import { widgets as workshopDocsWidgets } from "./workshop/docs/widgets";
import { widgets as invoicesWidgets } from "./office/invoices/widgets";
import { widgets as employeesWidgets } from "./office/employees/widgets";
import { widgets as fleetWidgets } from "./office/fleet/widgets";
import { widgets as officeDocsWidgets } from "./office/docs/widgets";
import { widgets as networkWidgets } from "./it/network/widgets";
import { widgets as itDocsWidgets } from "./it/docs/widgets";
import { settingsTabs as workshopProfileSettings } from "./admin/settings/settings-tab";
import { settingsTabs as backupSettings } from "./admin/backup/settings-tab";
import { settingsTabs as updatesSettings } from "./admin/updates/settings-tab";

/**
 * Composition Root: hier – und nur hier – werden die Beiträge der Funktionen (Dashboard-Bausteine,
 * Einstellungs-Reiter) eingesammelt. Neue Funktion mit Widget/Einstellungen: Zeile ergänzen.
 */
const ALL_WIDGETS: WidgetDef[] = [
  ...appointmentsWidgets,
  ...tiresWidgets,
  ...workshopDocsWidgets,
  ...invoicesWidgets,
  ...employeesWidgets,
  ...fleetWidgets,
  ...officeDocsWidgets,
  ...networkWidgets,
  ...itDocsWidgets,
];

const ALL_SETTINGS_TABS: SettingsTabDef[] = [...workshopProfileSettings, ...appointmentsSettings, ...tiresSettings, ...backupSettings, ...updatesSettings];

export type NavEntry = { id: string; href: string; labelKey: MessageKey; icon: IconName; module: ModuleId; order: number };

const moduleOrder = (id: string) => MODULES.find((m) => m.id === id)?.order ?? 0;

/** Navigation: nur Einträge, deren Funktion aktiv ist (Session filtert Rechte bereits) und für die das Recht vorliegt. */
export function navFor(session: AppSession): NavEntry[] {
  return FEATURES.filter((f) => session.features.has(fullFeatureId(f)))
    .flatMap((f) => f.nav.map((n) => ({ ...n, module: f.module as ModuleId })))
    .filter((n) => session.can(n.permission))
    .map(({ id, href, labelKey, icon, module, order }) => ({ id, href, labelKey, icon, module, order }))
    .sort((a, b) => moduleOrder(a.module) - moduleOrder(b.module) || a.order - b.order);
}

export type WidgetEntry = WidgetDef & { module: ModuleId };

export function widgetsFor(session: AppSession): WidgetEntry[] {
  return ALL_WIDGETS.filter((w) => session.features.has(w.feature) && session.can(w.permission))
    .map((w) => ({ ...w, module: moduleOfFeature(w.feature) }))
    .sort((a, b) => a.order - b.order);
}

export function settingsTabsFor(session: AppSession): SettingsTabDef[] {
  return ALL_SETTINGS_TABS.filter((tab) => session.features.has(tab.feature) && session.can(tab.permission)).sort((a, b) => a.order - b.order);
}

function moduleOfFeature(id: FeatureId): ModuleId {
  return id.split(".")[0] as ModuleId;
}
