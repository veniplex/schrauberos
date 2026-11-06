import "server-only";
import { featureJobs, featureOutboxHandlers } from "@/modules/jobs";
import { platformJobs } from "./platform";
import type { JobDef, OutboxHandlerDef } from "./types";

let cached: readonly JobDef[] | null = null;

export const allOutboxHandlers = (): readonly OutboxHandlerDef[] => featureOutboxHandlers;

/** Alle Jobs: Plattform und Funktionen. */
export function allJobs(): readonly JobDef[] {
  return (cached ??= [...platformJobs(allJobs, allOutboxHandlers), ...featureJobs]);
}
