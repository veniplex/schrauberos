import "server-only";
import { runApiCleanup } from "@/server/api/cleanup";
import { deliverOutbox, pruneOutbox } from "./outbox";
import { pruneJobData } from "./maintenance";
import { activeFeatureSet } from "./runner";
import type { JobDef, OutboxHandlerDef } from "./types";

/**
 * Jobs der Plattform (laufen immer, gehören keiner Funktion): Zustellung der Outbox und Aufräumen. Die Jobs der Funktionen kommen aus
 * `src/modules/jobs.ts`. `getAll` liefert alle Jobs (für das Aufräumen verwaister Zustände).
 */
export function platformJobs(getAll: () => readonly JobDef[], handlers: () => readonly OutboxHandlerDef[]): JobDef[] {
  return [
    {
      id: "platform.outbox",
      schedule: { every: 15_000 },
      retry: { baseDelayMs: 15_000, maxDelayMs: 5 * 60_000 },
      timeoutMs: 5 * 60_000,
      run: async ({ now }) => {
        const s = await deliverOutbox({ handlers: handlers(), activeFeatures: await activeFeatureSet(), now });
        return s.delivered + s.retried + s.failed + s.skipped === 0 ? undefined : `${s.delivered} zugestellt, ${s.retried} wiederholt, ${s.failed} fehlgeschlagen, ${s.skipped} ohne Abnehmer`;
      },
    },
    {
      id: "platform.outbox-prune",
      schedule: { cron: "20 3 * * *" },
      run: async ({ now }) => `${await pruneOutbox(now)} gelöscht`,
    },
    {
      id: "platform.jobs-prune",
      schedule: { cron: "30 3 * * *" },
      run: async ({ now }) => `${await pruneJobData(
        getAll().map((j) => j.id),
        now,
      )} gelöscht`,
    },
    {
      // abgelaufene Idempotenz-Schlüssel der API jedes Mal, alte Tokens einmal am Tag (siehe `server/api/cleanup.ts`)
      id: "platform.api-cleanup",
      schedule: { every: 10 * 60_000 },
      run: async () => `${await runApiCleanup()} gelöscht`,
    },
  ];
}
