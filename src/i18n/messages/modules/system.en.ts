import type { systemDe } from "./system.de";

export const systemEn: typeof systemDe = {
  feature: {
    name: "System status",
    description: "Scheduled background jobs (backups, cleanup, event delivery) with their latest results – failures are visible at once.",
  },
  title: "System status",
  description: "What the application does in the background: when a job last ran, whether it worked and when it is due again.",
  fine: "All good: no job has failed, is overdue or stuck, there are no abandoned events, and the scheduler is running.",
  problem: {
    failing_one: "{job}: the last run failed. It is retried automatically with a growing delay.",
    failing_other: "{job}: {count} runs in a row failed. It is retried automatically with a growing delay.",
    overdue: "{job}: has been due for minutes and was not started.",
    stuck: "{job}: a run is stuck (lock expired, never finished).",
    interrupted: "{job}: the last run was interrupted by a restart and will be repeated shortly.",
    outboxFailed_one: "One event could not be delivered and was abandoned (see “Events”).",
    outboxFailed_other: "{count} events could not be delivered and were abandoned (see “Events”).",
    runnerStale: "The scheduler last reported at {date} – background jobs are probably no longer running.",
    runnerDown: "The scheduler for background jobs has not started.",
    runnerError: "The scheduler reports an error (for example database unreachable) and retries on every tick.",
  },
  runner: { lastActive: "Scheduler last active: {date}", notYet: "The scheduler has not ticked yet (it takes about a minute after startup)." },
  jobs: {
    title: "Scheduled jobs",
    cols: { job: "Job", schedule: "Schedule", last: "Last run", result: "Result", next: "Next run", failures: "Failures in a row" },
    never: "never",
    running: "running now",
    inactive: "paused (feature switched off)",
    empty: "No jobs registered.",
  },
  schedule: {
    everySeconds: "every {n} seconds",
    everyMinutes: "every {n} minutes",
    everyHours: "every {n} hours",
    cron: "{cron} (workshop local time)",
  },
  names: {
    backup: { auto: "Automatic backup", retention: "Clean up backups (retention)" },
    audit: { retention: "Clean up audit log (retention)" },
    platform: {
      outbox: "Deliver events (outbox)",
      "outbox-prune": "Clean up delivered events",
      "jobs-prune": "Clean up old job results",
      "api-cleanup": "Clean up API data (keys, old tokens)",
    },
  },
  status: { ok: "OK", error: "Failed", interrupted: "Interrupted", running: "Running" },
  runs: {
    title: "Latest runs",
    cols: { time: "Time", job: "Job", status: "Status", duration: "Duration", message: "Message" },
    empty: "No runs yet.",
    seconds: "{n} s",
    millis: "{n} ms",
  },
  outbox: {
    title: "Events (outbox)",
    hint: "Changes that other systems should learn about (email, webhooks) are queued here and delivered. Failed ones are given up after several attempts. If the recipient's feature is switched off, events stay open for it for up to 14 days and are delivered when it is switched on again.",
    pending: "Pending",
    failed: "Given up",
    lastError: "Last: {error}",
  },
};
