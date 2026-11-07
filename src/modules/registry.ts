import type { MessageKey } from "@/i18n/translate";
import type { AppSession } from "@/server/auth/session";
import { FEATURES, MODULES, fullFeatureId, isPermission, type FeatureId, type ModuleId, type Permission } from "./catalog";
import { withTimeout } from "@/lib/with-timeout";
import type { IconName } from "./define";
import { logError } from "@/lib/log-safe";
import type { SearchHit, SearchProviderDef, SettingsTabDef, SetupCheckDef, WidgetDef } from "./types";

import { widgets as appointmentsWidgets } from "./workshop/appointments/widgets";
import { settingsTabs as appointmentsSettings } from "./workshop/appointments/settings-tab";
import { widgets as tiresWidgets } from "./workshop/tires/widgets";
import { widgets as vehiclesWidgets } from "./workshop/vehicles/widgets";
import { settingsTabs as tiresSettings } from "./workshop/tires/settings-tab";
import { widgets as invoicesWidgets } from "./office/invoices/widgets";
import { widgets as employeesWidgets } from "./office/employees/widgets";
import { widgets as fleetWidgets } from "./office/fleet/widgets";
import { widgets as networkWidgets } from "./it/network/widgets";
import { widgets as itDocsWidgets } from "./it/docs/widgets";
import { widgets as handbookWidgets } from "./handbook/manual/widgets";
import { settingsTabs as workshopProfileSettings } from "./admin/settings/settings-tab";
import { settingsTabs as backupSettings } from "./admin/backup/settings-tab";
import { widgets as backupWidgets } from "./admin/backup/widgets";
import { setupChecks as settingsChecks } from "./admin/settings/setup-checks";
import { setupChecks as usersChecks } from "./admin/users/setup-checks";
import { setupChecks as backupChecks } from "./admin/backup/setup-checks";
import { setupChecks as appointmentsChecks } from "./workshop/appointments/setup-checks";
import { setupChecks as employeesChecks } from "./office/employees/setup-checks";
import { settingsTabs as updatesSettings } from "./admin/updates/settings-tab";

import { searchProviders as appointmentsSearch } from "./workshop/appointments/search";
import { searchProviders as tiresSearch } from "./workshop/tires/search";
import { searchProviders as customersSearch } from "./workshop/customers/search";
import { searchProviders as vehiclesSearch } from "./workshop/vehicles/search";
import { searchProviders as invoicesSearch } from "./office/invoices/search";
import { searchProviders as employeesSearch } from "./office/employees/search";
import { searchProviders as fleetSearch } from "./office/fleet/search";
import { searchProviders as networkSearch } from "./it/network/search";
import { searchProviders as itDocsSearch } from "./it/docs/search";
import { searchProviders as handbookSearch } from "./handbook/manual/search";

/**
 * Composition Root: hier – und nur hier – werden die Beiträge der Funktionen (Dashboard-Bausteine,
 * Einstellungs-Reiter) eingesammelt. Neue Funktion mit Widget/Einstellungen: Zeile ergänzen.
 */
const ALL_WIDGETS: WidgetDef[] = [
  ...appointmentsWidgets,
  ...tiresWidgets,
  ...vehiclesWidgets,
  ...invoicesWidgets,
  ...employeesWidgets,
  ...fleetWidgets,
  ...networkWidgets,
  ...itDocsWidgets,
  ...handbookWidgets,
  ...backupWidgets,
];

/** Suchanbieter der Funktionen (Schnellsuche). Neue Funktion mit durchsuchbaren Daten: Zeile ergänzen – `src/modules/search.test.ts` verlangt sie für jede fachliche Funktion. */
export const ALL_SEARCH_PROVIDERS: SearchProviderDef[] = [
  ...appointmentsSearch,
  ...tiresSearch,
  ...customersSearch,
  ...vehiclesSearch,
  ...invoicesSearch,
  ...employeesSearch,
  ...fleetSearch,
  ...networkSearch,
  ...itDocsSearch,
  ...handbookSearch,
];

const ALL_SETTINGS_TABS: SettingsTabDef[] = [...workshopProfileSettings, ...appointmentsSettings, ...tiresSettings, ...backupSettings, ...updatesSettings];

/** Punkte der Einrichtungs-Checkliste (Administration). Neue Funktion mit Einrichtungsschritten: `setup-checks.ts` anlegen und hier eintragen. */
const ALL_SETUP_CHECKS: SetupCheckDef[] = [...settingsChecks, ...usersChecks, ...backupChecks, ...appointmentsChecks, ...employeesChecks];

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
  return ALL_WIDGETS.filter((w) => session.features.has(w.feature) && session.can(w.permission) && (w.uses ?? []).every((f) => session.features.has(f)))
    .map((w) => ({ ...w, module: moduleOfFeature(w.feature) }))
    .sort((a, b) => a.order - b.order);
}

/** Alle Bausteine mit Funktion, Recht und Titel – ohne Rücksicht auf eine Sitzung (Vorschau „Was sieht diese Rolle?“ in der Rollenmaske). */
export function widgetCatalog(): Array<{ id: string; feature: FeatureId; permission: Permission; titleKey: MessageKey; module: ModuleId }> {
  return ALL_WIDGETS.map((w) => ({ id: w.id, feature: w.feature, permission: w.permission, titleKey: w.titleKey, module: moduleOfFeature(w.feature) }));
}

export type SetupCheckResult = { id: string; labelKey: MessageKey; hintKey: MessageKey; href: string; recommended: boolean; done: boolean };

/**
 * Einrichtungs-Checkliste für die Administration: die Punkte aktiver Funktionen, für die die Person das Recht hat, mit ihrem tatsächlichen Stand (`done`). Nur für Administratoren.
 * Ein Punkt, dessen Prüfung scheitert, fehlt (wird protokolliert) – er hält die Übersicht nicht auf.
 */
export async function setupChecksFor(session: AppSession, secure: boolean): Promise<SetupCheckResult[]> {
  if (!session.user.isAdmin) return [];
  const checks = ALL_SETUP_CHECKS.filter((c) => session.features.has(c.feature) && session.can(c.permission)).sort((a, b) => a.order - b.order);
  const results = await Promise.all(
    checks.map(async (c): Promise<SetupCheckResult | null> => {
      try {
        return { id: c.id, labelKey: c.labelKey, hintKey: c.hintKey, href: c.href, recommended: c.recommended ?? false, done: await c.done({ session, secure }) };
      } catch (error) {
        logError(`setup-check:${c.id}`, error);
        return null;
      }
    }),
  );
  return results.filter((r): r is SetupCheckResult => r !== null);
}

export function settingsTabsFor(session: AppSession): SettingsTabDef[] {
  return ALL_SETTINGS_TABS.filter((tab) => session.features.has(tab.feature) && session.can(tab.permission)).sort((a, b) => a.order - b.order);
}

function moduleOfFeature(id: FeatureId): ModuleId {
  return id.split(".")[0] as ModuleId;
}

/** Suchanbieter, die für diese Sitzung gelten: Funktion aktiv und Recht vorhanden (wie bei Widgets). */
export function searchProvidersFor(session: AppSession): SearchProviderDef[] {
  return ALL_SEARCH_PROVIDERS.filter((p) => session.features.has(p.feature) && session.can(p.permission)).sort((a, b) => a.order - b.order);
}

/** Wie lange ein Suchanbieter höchstens braucht (die Abfrage läuft danach weiter, ihr Ergebnis wird verworfen). */
export const SEARCH_PROVIDER_TIMEOUT_MS = 3000;

export type SearchGroup = { id: string; groupKey: MessageKey; hits: SearchHit[] };

/**
 * Schnellsuche über alle Anbieter der Sitzung. Jeder Anbieter läuft für sich: ein Fehler (oder zu langsame Abfrage) eines Anbieters nimmt die Treffer der anderen nicht mit.
 * Die Plattform ruft nur diese Funktion auf und kennt keine Funktion; Rechte und Sichtbarkeit je Treffer sind Sache des Anbieters.
 */
export async function searchFor(session: AppSession, query: string, limit = 5, timeoutMs = SEARCH_PROVIDER_TIMEOUT_MS): Promise<SearchGroup[]> {
  const providers = searchProvidersFor(session);
  const results = await Promise.all(
    providers.map(async (provider): Promise<SearchGroup> => {
      try {
        // zu langsam (große Tabelle, ungeindexiertes Feld): ohne Treffer statt die ganze Suche aufzuhalten
        return { id: provider.id, groupKey: provider.groupKey, hits: await withTimeout(provider.search(query, { session, limit }), timeoutMs, []) };
      } catch {
        return { id: provider.id, groupKey: provider.groupKey, hits: [] };
      }
    }),
  );
  return results.filter((group) => group.hits.length > 0);
}

export type QuickActionEntry = { id: string; href: string; labelKey: MessageKey; icon: IconName; module: ModuleId; order: number };

/** Alle Schnellaktionen der Funktionen mit Funktion und Recht – ohne Rücksicht auf eine Sitzung (Vorschau der Rollenmaske). */
export function quickActionCatalog(): Array<QuickActionEntry & { feature: FeatureId; permission: string }> {
  return FEATURES.flatMap((f) =>
    ((f as { quickActions?: readonly { id: string; href: string; labelKey: MessageKey; icon: IconName; permission: string; order: number }[] }).quickActions ?? []).map((a) => ({
      ...a,
      module: f.module as ModuleId,
      feature: fullFeatureId(f),
    })),
  );
}

type RawQuickAction = { id: string; href: string; labelKey: MessageKey; icon: IconName; permission: string; order: number; kind?: "create" | "open" };

function allowedQuickActions(session: AppSession) {
  return FEATURES.filter((f) => session.features.has(fullFeatureId(f)))
    .flatMap((f) => ((f as { quickActions?: readonly RawQuickAction[] }).quickActions ?? []).map((a) => ({ ...a, module: f.module as ModuleId })))
    .filter((a) => isPermission(a.permission) && session.can(a.permission));
}

/** Einträge des globalen „Neu“-Menüs: aktive Funktionen, für die die Person das Recht hat – nur Anlegen-Aktionen, sortiert nach Modul und Reihenfolge. */
export function quickActionsFor(session: AppSession): QuickActionEntry[] {
  return allowedQuickActions(session)
    .filter((a) => a.kind !== "open")
    .map(({ id, href, labelKey, icon, module, order }) => ({ id, href, labelKey, icon, module, order }))
    .sort((a, b) => moduleOrder(a.module) - moduleOrder(b.module) || a.order - b.order);
}

/**
 * Schnellaktionen der Übersicht (P2b-4): bis zu `limit` (3) je Person – zuerst die Anlegen-Aktionen nach `order` (die Reihenfolge der Funktionen: Termin, Reifensatz, Kunde …), dann, was daran fehlt,
 * mit Ansichten (`kind: "open"`: Kalender heute, Reifensätze ein-/ausbuchen, Fahrzeuge) aufgefüllt. So bekommt jede Rolle ihre eigenen, ohne dass eine Rolle gesondert erfasst wäre.
 */
export function shortcutsFor(session: AppSession, limit = 3): QuickActionEntry[] {
  const all = allowedQuickActions(session).sort((a, b) => a.order - b.order);
  return [...all.filter((a) => a.kind !== "open"), ...all.filter((a) => a.kind === "open")]
    .slice(0, limit)
    .map(({ id, href, labelKey, icon, module, order }) => ({ id, href, labelKey, icon, module, order }));
}
