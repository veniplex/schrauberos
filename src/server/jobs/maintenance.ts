import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as appDb } from "@/server/db";

/** Aufbewahrung der Ergebnisse: höchstens so viele Tage und so viele Läufe je Job (die neuesten). */
export const JOB_RUNS_KEEP_DAYS = 30;
export const JOB_RUNS_KEEP_PER_JOB = 200;

type Client = Pick<PrismaClient, "jobRun" | "jobState">;

/**
 * Räumt die Ergebnistabelle auf (Job `platform.jobs-prune`): Läufe, die älter als 30 Tage sind oder über die neuesten 200 je Job hinausgehen, und den
 * Zustand von Jobs, die es nicht mehr gibt (`definedIds`). Laufende Läufe bleiben. Liefert die Anzahl gelöschter Läufe.
 */
export async function pruneJobData(definedIds: readonly string[], now = new Date(), db: Client = appDb): Promise<number> {
  const cutoff = new Date(now.getTime() - JOB_RUNS_KEEP_DAYS * 86_400_000);
  let removed = (await db.jobRun.deleteMany({ where: { startedAt: { lt: cutoff }, status: { not: "running" } } })).count;

  const ids = (await db.jobRun.groupBy({ by: ["jobId"], _count: { _all: true }, having: { jobId: { _count: { gt: JOB_RUNS_KEEP_PER_JOB } } } })).map((g) => g.jobId);
  for (const jobId of ids) {
    const oldest = await db.jobRun.findMany({ where: { jobId, status: { not: "running" } }, orderBy: { startedAt: "desc" }, skip: JOB_RUNS_KEEP_PER_JOB, select: { id: true } });
    if (oldest.length) removed += (await db.jobRun.deleteMany({ where: { id: { in: oldest.map((r) => r.id) } } })).count;
  }

  await db.jobState.deleteMany({ where: { id: { notIn: [...definedIds] } } });
  await db.jobRun.deleteMany({ where: { jobId: { notIn: [...definedIds] }, status: { not: "running" } } });
  return removed;
}
