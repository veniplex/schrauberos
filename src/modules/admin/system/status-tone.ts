import type { StatusTone } from "@/lib/status-tone";

/** Ausgang eines Job-Laufs (`JobRun.status`). */
export const JOB_STATUSES = ["ok", "error", "interrupted", "running"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_TONE: Record<JobStatus, StatusTone> = { ok: "success", error: "danger", interrupted: "warning", running: "info" };
