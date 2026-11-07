import type { Metadata } from "next";
import { Alert, Card, EmptyState, StatusBadge } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import type { Schedule } from "@/lib/jobs/schedule";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { evaluateSystem, problemTone, type SystemProblem } from "@/server/jobs/health";
import { jobRunner } from "@/server/jobs";
import { activeFeatureSet } from "@/server/jobs/runner";
import { jobStatusRows, recentJobRuns } from "@/server/jobs/status";
import { JOB_STATUS_TONE, type JobStatus } from "@/modules/admin/system/status-tone";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("system.title") };
}

const toneOf = (status: string | null) => JOB_STATUS_TONE[status as JobStatus] ?? "neutral";

export default async function SystemPage() {
  await requirePermission("system.view");
  const { t, tp, td, date } = await getI18n();
  const [jobs, runs, active, pending, failed, lastFailed] = await Promise.all([
    jobStatusRows(),
    recentJobRuns(30),
    activeFeatureSet(),
    db.outboxEvent.count({ where: { processedAt: null, failedAt: null } }),
    db.outboxEvent.count({ where: { failedAt: { not: null } } }),
    db.outboxEvent.findFirst({ where: { failedAt: { not: null } }, orderBy: { failedAt: "desc" }, select: { lastError: true } }),
  ]);
  const when = (d: Date | string) => date(d, { dateStyle: "short", timeStyle: "medium" });
  const nameOf = (id: string) => td(`system.names.${id}`, id);
  const runner = jobRunner().status();
  const problems = evaluateSystem({
    now: new Date(),
    jobs: jobs.map((j) => ({ id: j.id, active: !j.feature || active.has(j.feature), failures: j.failures, lastStatus: j.lastStatus, nextRunAt: j.nextRunAt, lockedUntil: j.lockedUntil })),
    outboxFailed: failed,
    runner,
  });
  const problemText = (p: SystemProblem) => {
    switch (p.code) {
      case "failing":
        return tp("system.problem.failing", p.failures, { job: nameOf(p.jobId) });
      case "overdue":
        return t("system.problem.overdue", { job: nameOf(p.jobId) });
      case "stuck":
        return t("system.problem.stuck", { job: nameOf(p.jobId) });
      case "interrupted":
        return t("system.problem.interrupted", { job: nameOf(p.jobId) });
      case "outboxFailed":
        return tp("system.problem.outboxFailed", p.count);
      case "runnerStale":
        return t("system.problem.runnerStale", { date: when(p.lastTickAt) });
      case "runnerDown":
        return t("system.problem.runnerDown");
      case "runnerError":
        return t("system.problem.runnerError");
    }
  };

  const scheduleText = (schedule: Schedule) => {
    if ("cron" in schedule) return t("system.schedule.cron", { cron: schedule.cron });
    const seconds = Math.round(schedule.every / 1000);
    if (seconds < 120) return t("system.schedule.everySeconds", { n: seconds });
    if (seconds < 2 * 3600) return t("system.schedule.everyMinutes", { n: Math.round(seconds / 60) });
    return t("system.schedule.everyHours", { n: Math.round(seconds / 3600) });
  };
  const duration = (ms: number | null) => (ms === null ? "–" : ms < 1000 ? t("system.runs.millis", { n: ms }) : t("system.runs.seconds", { n: Math.round(ms / 100) / 10 }));

  return (
    <>
      <PageHeader title={t("system.title")} description={t("system.description")} help="admin.system" />
      <div className="flex max-w-6xl flex-col gap-5">
        {problems.length === 0 ? (
          <Alert tone="success">{t("system.fine")}</Alert>
        ) : (
          <Alert tone={problemTone(problems)}>
            <ul className="list-disc pl-5">
              {problems.map((p, i) => (
                <li key={i}>{problemText(p)}</li>
              ))}
            </ul>
          </Alert>
        )}
        <p className="text-xs text-ink-muted">{runner.lastTickAt ? t("system.runner.lastActive", { date: when(runner.lastTickAt) }) : t("system.runner.notYet")}</p>

        <section aria-labelledby="jobs-title">
          <h2 id="jobs-title" className="mb-2 text-sm font-semibold">
            {t("system.jobs.title")}
          </h2>
          <DataTable
            caption={t("system.jobs.title")}
            rows={jobs}
            rowKey={(j) => j.id}
            minWidth="56rem"
            empty={<EmptyState title={t("system.jobs.empty")} />}
            columns={[
              { id: "job", header: t("system.jobs.cols.job"), priority: "primary", cell: (j) => nameOf(j.id) },
              { id: "schedule", header: t("system.jobs.cols.schedule"), cell: (j) => <span className="text-ink-muted">{scheduleText(j.schedule)}</span> },
              {
                id: "last",
                header: t("system.jobs.cols.last"),
                cell: (j) =>
                  j.running ? (
                    <StatusBadge tone="info">{t("system.jobs.running")}</StatusBadge>
                  ) : j.lastRunAt ? (
                    <span className="inline-flex flex-wrap items-center gap-2 tabular">
                      {when(j.lastRunAt)} <StatusBadge tone={toneOf(j.lastStatus)}>{td(`system.status.${j.lastStatus}`, j.lastStatus ?? "–")}</StatusBadge>
                    </span>
                  ) : (
                    <span className="text-ink-muted">{t("system.jobs.never")}</span>
                  ),
              },
              { id: "result", header: t("system.jobs.cols.result"), priority: "low", cell: (j) => <span className="break-words text-ink-muted">{j.lastMessage ?? "–"}</span> },
              {
                id: "next",
                header: t("system.jobs.cols.next"),
                cell: (j) => {
                  const inactive = !!j.feature && !active.has(j.feature);
                  return <span className="tabular text-ink-muted">{inactive ? t("system.jobs.inactive") : j.nextRunAt ? when(j.nextRunAt) : "–"}</span>;
                },
              },
              { id: "failures", header: t("system.jobs.cols.failures"), align: "end", cell: (j) => (j.failures > 0 ? <StatusBadge tone="danger">{j.failures}</StatusBadge> : "0") },
            ]}
          />
        </section>

        <Card title={t("system.outbox.title")}>
          <p className="mb-3 text-sm text-ink-muted">{t("system.outbox.hint")}</p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>
              {t("system.outbox.pending")}: <strong className="tabular">{pending}</strong>
            </span>
            <span>
              {t("system.outbox.failed")}: <strong className="tabular">{failed}</strong>
            </span>
            {lastFailed?.lastError ? <span className="text-ink-muted">{t("system.outbox.lastError", { error: lastFailed.lastError })}</span> : null}
          </div>
        </Card>

        <section aria-labelledby="runs-title">
          <h2 id="runs-title" className="mb-2 text-sm font-semibold">
            {t("system.runs.title")}
          </h2>
          <DataTable
            caption={t("system.runs.title")}
            rows={runs}
            rowKey={(r) => r.id}
            minWidth="44rem"
            empty={<EmptyState title={t("system.runs.empty")} />}
            columns={[
              { id: "time", header: t("system.runs.cols.time"), priority: "primary", cell: (r) => <span className="tabular whitespace-nowrap">{when(r.startedAt)}</span> },
              { id: "job", header: t("system.runs.cols.job"), cell: (r) => nameOf(r.jobId) },
              { id: "status", header: t("system.runs.cols.status"), cell: (r) => <StatusBadge tone={toneOf(r.status)}>{td(`system.status.${r.status}`, r.status)}</StatusBadge> },
              { id: "duration", header: t("system.runs.cols.duration"), cell: (r) => <span className="tabular text-ink-muted">{duration(r.durationMs)}</span> },
              { id: "message", header: t("system.runs.cols.message"), cell: (r) => <span className="break-words text-ink-muted">{r.message ?? "–"}</span> },
            ]}
          />
        </section>
      </div>
    </>
  );
}
