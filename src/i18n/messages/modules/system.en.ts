import type { systemDe } from "./system.de";

export const systemEn: typeof systemDe = {
  feature: {
    name: "System status",
    description: "Scheduled background jobs (backups, cleanup, event delivery) with their latest results – failures are visible at once.",
  },
  title: "System status",
  description: "What the application does in the background: when a job last ran, whether it worked and when it is due again.",
  fine: "All scheduled jobs are running without errors.",
  problems_one: "One scheduled job failed. It is retried automatically with a growing delay.",
  problems_other: "{count} scheduled jobs failed. They are retried automatically with a growing delay.",
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
    hint: "Changes that other systems should learn about (email, webhooks) are queued here and delivered. Failed ones are given up after several attempts.",
    pending: "Pending",
    failed: "Given up",
    lastError: "Last: {error}",
  },
};
