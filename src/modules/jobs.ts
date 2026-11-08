import type { JobDef, OutboxHandlerDef } from "@/server/jobs/types";

import { jobs as audit } from "./admin/audit/jobs";
import { jobs as backup } from "./admin/backup/jobs";
import { jobs as mail, outboxHandlers as mailHandlers } from "./admin/mail/jobs";
import { jobs as apiAdmin, outboxHandlers as apiHandlers } from "./admin/api/jobs";
import { jobs as billing } from "./office/billing/jobs";
import { jobs as files } from "./workshop/files/jobs";
import { jobs as network } from "./it/network/jobs";

/**
 * Composition Root des Job-Runners (wird nur von `src/server/jobs/registry.ts` importiert – nicht über `registry.ts`, das jede Seite lädt): Jede Funktion
 * meldet hier ihre geplanten Jobs (`jobs.ts` → `jobs`) und ihre Abnehmer für Ereignisse der Outbox (`outboxHandlers`) an. Der Runner führt sie nur aus,
 * solange die Funktion aktiv ist (`feature`). Jobs der Plattform selbst stehen in `src/server/jobs/platform.ts`.
 * Neue Funktion mit Job: `jobs.ts` anlegen, Zeile ergänzen – `src/server/jobs/jobs.test.ts` prüft IDs, Zeitpläne und die Zuordnung zur Funktion.
 */
export const featureJobs: readonly JobDef[] = [...audit, ...backup, ...mail, ...apiAdmin, ...files, ...billing, ...network];

export const featureOutboxHandlers: readonly OutboxHandlerDef[] = [...mailHandlers, ...apiHandlers];
