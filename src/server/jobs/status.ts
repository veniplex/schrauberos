import "server-only";
import { db } from "@/server/db";
import { allJobs } from "./registry";

export type JobStatusRow = {
  id: string;
  feature: string | null;
  schedule: { every: number } | { cron: string };
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastMessage: string | null;
  failures: number;
  running: boolean;
  /** Ende der Sperre (liegt sie in der Vergangenheit, hängt der Lauf) */
  lockedUntil: Date | null;
};

export type JobRunRow = { id: string; jobId: string; startedAt: Date; durationMs: number | null; status: string; message: string | null; attempt: number };

/** Alle bekannten Jobs mit ihrem Zustand (für die Statusansicht der Verwaltung). */
export async function jobStatusRows(): Promise<JobStatusRow[]> {
  const states = new Map((await db.jobState.findMany()).map((s) => [s.id, s]));
  return allJobs().map((job) => {
    const s = states.get(job.id);
    return {
      id: job.id,
      feature: job.feature ?? null,
      schedule: job.schedule,
      nextRunAt: s?.nextRunAt ?? null,
      lastRunAt: s?.lastRunAt ?? null,
      lastStatus: s?.lastStatus ?? null,
      lastMessage: s?.lastMessage ?? null,
      failures: s?.failures ?? 0,
      running: !!s?.lockedUntil,
      lockedUntil: s?.lockedUntil ?? null,
    };
  });
}

/** Die letzten Läufe (neueste zuerst), optional nur eines Jobs. */
export async function recentJobRuns(limit = 30, jobId?: string): Promise<JobRunRow[]> {
  return db.jobRun.findMany({ where: jobId ? { jobId } : {}, orderBy: { startedAt: "desc" }, take: limit });
}

/** Zustand eines Jobs (z. B. für einen Hinweis auf der Backup-Seite); null, wenn er noch nie gelaufen ist. */
export async function jobStateOf(jobId: string) {
  return db.jobState.findUnique({ where: { id: jobId } });
}
