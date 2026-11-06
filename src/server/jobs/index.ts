import "server-only";
import { createJobRunner, type JobRunner } from "./runner";
import { allJobs } from "./registry";

export { allJobs } from "./registry";
export type { JobDef, JobContext, OutboxHandlerDef, OutboxMessage } from "./types";

const globalForJobs = globalThis as unknown as { __jobRunner?: JobRunner };

/** Der Runner dieses Prozesses (einer, auch wenn Next den Code mehrfach bündelt). */
export function jobRunner(): JobRunner {
  return (globalForJobs.__jobRunner ??= createJobRunner({ jobs: allJobs }));
}

/** Startet den Zeitgeber der Jobs (aus `startApp`, nach Migrationen und Basisdaten). */
export function startJobRunner(): void {
  jobRunner().start();
}
