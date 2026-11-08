import "server-only";
import { runApiCleanup } from "@/server/api/cleanup";
import { deliverOutbox, hasPendingOutbox, pruneOutbox } from "./outbox";
import { pruneJobData } from "./maintenance";
import { activeFeatureSet } from "./runner";
import { describeVacuum, runIncrementalVacuum } from "./vacuum";
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
      // Alle 15 s: Gibt es nichts zuzustellen, bleibt es bei einem Zählzugriff – keine Sperre, kein Lauf-Eintrag
      shouldRun: ({ now }) => hasPendingOutbox(now),
      run: async ({ now, signal }) => {
        const s = await deliverOutbox({ handlers: handlers(), activeFeatures: await activeFeatureSet(), now, signal });
        const parts = [
          s.delivered && `${s.delivered} zugestellt`,
          s.retried && `${s.retried} wiederholt`,
          s.failed && `${s.failed} fehlgeschlagen`,
          s.skipped && `${s.skipped} ohne Abnehmer`,
          s.parked && `${s.parked} zurückgestellt (Funktion aus)`,
        ].filter(Boolean);
        return parts.length ? parts.join(", ") : undefined;
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
      // nach den Aufbewahrungsjobs (3:00 bis 3:50): freie Seiten der Datenbank zurückgeben, begrenzt je Lauf (siehe `server/jobs/vacuum.ts`)
      id: "platform.incremental-vacuum",
      schedule: { cron: "30 4 * * *" },
      timeoutMs: 5 * 60_000,
      run: async ({ signal }) => describeVacuum(await runIncrementalVacuum({ signal })),
    },
    {
      // abgelaufene Idempotenz-Schlüssel der API jedes Mal, alte Tokens einmal am Tag (siehe `server/api/cleanup.ts`)
      id: "platform.api-cleanup",
      schedule: { every: 10 * 60_000 },
      run: async () => {
        const removed = await runApiCleanup();
        return removed > 0 ? `${removed} gelöscht` : undefined; // alle 10 Minuten: nur Auffälliges festhalten
      },
    },
  ];
}
