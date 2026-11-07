import type { MessageKey } from "@/i18n/translate";
import { FEATURES, MODULES, fullFeatureId, type ModuleId, type Permission } from "./catalog";
import type { HelpTopicDef } from "./types";

import { help as appointments } from "./workshop/appointments/help";
import { help as tires } from "./workshop/tires/help";
import { help as orders } from "./workshop/orders/help";
import { help as parts } from "./workshop/parts/help";
import { help as files } from "./workshop/files/help";
import { help as checklists } from "./workshop/checklists/help";
import { help as customers } from "./workshop/customers/help";
import { help as vehicles } from "./workshop/vehicles/help";
import { help as invoices } from "./office/invoices/help";
import { help as employees } from "./office/employees/help";
import { help as time } from "./office/time/help";
import { help as fleet } from "./office/fleet/help";
import { help as network } from "./it/network/help";
import { help as itDocs } from "./it/docs/help";
import { help as manual } from "./handbook/manual/help";
import { help as users } from "./admin/users/help";
import { help as roles } from "./admin/roles/help";
import { help as settings } from "./admin/settings/help";
import { help as modules } from "./admin/modules/help";
import { help as backup } from "./admin/backup/help";
import { help as mail } from "./admin/mail/help";
import { help as updates } from "./admin/updates/help";
import { help as audit } from "./admin/audit/help";
import { help as system } from "./admin/system/help";

/**
 * Composition Root der Hilfe: hier werden die Themen aller Funktionen eingesammelt (angezeigt wird in der Reihenfolge
 * der Funktionen, `order` im Katalog). Neue Funktion mit Hilfe: `help.ts` anlegen, Zeile ergänzen, Markdown-Datei unter `docs/` ablegen.
 */
export const ALL_HELP_TOPICS: readonly HelpTopicDef[] = [
  ...appointments,
  ...orders,
  ...parts,
  ...files,
  ...checklists,
  ...tires,
  ...customers,
  ...vehicles,
  ...invoices,
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

export type HelpTopic = { id: string; doc: string };
export type HelpGroup = { module: ModuleId; nameKey: MessageKey; topics: HelpTopic[] };

/** Was die Hilfe von der Anmeldung braucht (`AppSession` erfüllt das). */
type HelpAccess = { features: ReadonlySet<string>; can: (permission: Permission) => boolean };

/**
 * Darf diese Anmeldung das Kapitel `id` aufrufen? Kapitel einer Funktion nur bei aktiver Funktion und vorhandenem Leserecht (sonst 404); allgemeine Kapitel der Plattform
 * (`arbeiten-in-der-anwendung` …) immer. Der Hilfe-Knopf im Seitenkopf erscheint nur, wenn das stimmt – Bearbeiten-Seiten verlangen oft nur `*.edit`, das Kapitel `*.view`.
 */
export function helpTopicVisible(id: string, session: HelpAccess): boolean {
  const topic = ALL_HELP_TOPICS.find((t) => t.id === id);
  return topic ? session.features.has(topic.feature) && session.can(topic.permission) : true;
}

const featureOrder = (id: string) => FEATURES.find((f) => fullFeatureId(f) === id)?.order ?? 0;

/**
 * Die Hilfe-Themen, die diese Anmeldung sehen darf, nach Modulen gegliedert (Reihenfolge wie in der Navigation).
 * Themen ausgeschalteter Funktionen oder ohne Recht fehlen, Module ohne Themen ebenso.
 */
export function helpFor(session: HelpAccess): HelpGroup[] {
  const visible = ALL_HELP_TOPICS.filter((t) => session.features.has(t.feature) && session.can(t.permission)).sort(
    (a, b) => featureOrder(a.feature) - featureOrder(b.feature),
  );
  return [...MODULES]
    .sort((a, b) => a.order - b.order)
    .map((m) => ({
      module: m.id,
      nameKey: m.nameKey,
      topics: visible.filter((t) => t.feature.startsWith(`${m.id}.`)).map(({ id, doc }) => ({ id, doc })),
    }))
    .filter((g) => g.topics.length > 0);
}
