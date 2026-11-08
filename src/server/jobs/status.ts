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
  /** Der Termin ist erreicht, aber die Vorabprüfung des Jobs (`shouldRun`) sagt „nichts zu tun“: Der Runner lässt ihn dann ohne Schreibzugriff liegen, `nextRunAt` bleibt alt – das ist kein Rückstand. */
  idle: boolean;
};

export type JobRunRow = { id: string; jobId: string; startedAt: Date; durationMs: number | null; status: string; message: string | null; attempt: number };

/** Alle bekannten Jobs mit ihrem Zustand (für die Statusansicht der Verwaltung). */
export async function jobStatusRows(): Promise<JobStatusRow[]> {
  const states = new Map((await db.jobState.findMany()).map((s) => [s.id, s]));
  const now = new Date();
  return Promise.all(allJobs().map(async (job) => {
    const s = states.get(job.id);
    // Ein fälliger Job mit Vorabprüfung, die „nichts zu tun“ meldet, wartet auf Arbeit – er ist nicht überfällig (sonst meldete der Systemstatus nach 5 Minuten jeden ruhenden Job)
    let idle = false;
    if (job.shouldRun && s?.nextRunAt && s.nextRunAt.getTime() <= now.getTime() && !s.lockedUntil) {
      try {
        idle = !(await job.shouldRun({ now }));
      } catch {
        idle = false; // lässt sich die Vorabprüfung nicht beantworten, bleibt der Rückstand sichtbar
      }
    }
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
      idle,
    };
  }));
}

/** Die letzten Läufe (neueste zuerst), optional nur eines Jobs. */
export async function recentJobRuns(limit = 30, jobId?: string): Promise<JobRunRow[]> {
  return db.jobRun.findMany({ where: jobId ? { jobId } : {}, orderBy: { startedAt: "desc" }, take: limit });
}

/** Zustand eines Jobs (z. B. für einen Hinweis auf der Backup-Seite); null, wenn er noch nie gelaufen ist. */
export async function jobStateOf(jobId: string) {
  return db.jobState.findUnique({ where: { id: jobId } });
}
