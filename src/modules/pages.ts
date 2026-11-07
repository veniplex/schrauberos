import type { PageDef, PageKind, PageParam } from "./types";

import { pages as appointments } from "./workshop/appointments/pages";
import { pages as tires } from "./workshop/tires/pages";
import { pages as orders } from "./workshop/orders/pages";
import { pages as parts } from "./workshop/parts/pages";
import { pages as files } from "./workshop/files/pages";
import { pages as checklists } from "./workshop/checklists/pages";
import { pages as customers } from "./workshop/customers/pages";
import { pages as vehicles } from "./workshop/vehicles/pages";
import { pages as invoices } from "./office/invoices/pages";
import { pages as billing } from "./office/billing/pages";
import { pages as reports } from "./office/reports/pages";
import { pages as employees } from "./office/employees/pages";
import { pages as time } from "./office/time/pages";
import { pages as fleet } from "./office/fleet/pages";
import { pages as network } from "./it/network/pages";
import { pages as itDocs } from "./it/docs/pages";
import { pages as manual } from "./handbook/manual/pages";
import { pages as users } from "./admin/users/pages";
import { pages as roles } from "./admin/roles/pages";
import { pages as settings } from "./admin/settings/pages";
import { pages as modules } from "./admin/modules/pages";
import { pages as backup } from "./admin/backup/pages";
import { pages as mail } from "./admin/mail/pages";
import { pages as updates } from "./admin/updates/pages";
import { pages as audit } from "./admin/audit/pages";
import { pages as system } from "./admin/system/pages";

/**
 * Composition Root der Routen-Inventur für die Browser-CI (`e2e/`): hier werden die Seitenlisten aller Funktionen eingesammelt.
 * Neue Funktion: `pages.ts` anlegen (`definePages`), Zeile ergänzen – `pages.test.ts` schlägt fehl, wenn eine Funktion keine Seiten meldet.
 * Reine Daten (keine Next.js-/Datenbank-Imports), damit auch die Browser-Tests sie laden können.
 */
export const ALL_PAGES: readonly PageDef[] = [
  ...appointments,
  ...orders,
  ...parts,
  ...files,
  ...checklists,
  ...tires,
  ...customers,
  ...vehicles,
  ...invoices,
  ...billing,
  ...reports,
  ...employees,
  ...time,
  ...fleet,
  ...network,
  ...itDocs,
  ...manual,
  ...users,
  ...roles,
  ...settings,
  ...modules,
  ...backup,
  ...mail,
  ...updates,
  ...audit,
  ...system,
];

/** Seiten der Plattform (keiner Funktion zugeordnet): Übersicht, Konto, Hilfe, Anmeldung … */
export type PlatformPageDef = {
  path: string;
  kind: PageKind;
  /** Ohne Anmeldung erreichbar (Anmeldeseiten) */
  public?: boolean;
  params?: Record<string, PageParam>;
  query?: string;
  key?: boolean;
};

export const PLATFORM_PAGES: readonly PlatformPageDef[] = [
  { path: "/", kind: "other", key: true },
  { path: "/account", kind: "other" },
  { path: "/help", kind: "list", key: true },
  { path: "/help/[slug]", kind: "detail", params: { slug: { value: "handbook.manual" } } },
  { path: "/login", kind: "other", public: true, key: true },
  { path: "/login/recover", kind: "other", public: true },
  { path: "/login/verify", kind: "other", public: true },
  { path: "/login/key", kind: "other", public: true },
  { path: "/forbidden", kind: "other", public: true },
];
