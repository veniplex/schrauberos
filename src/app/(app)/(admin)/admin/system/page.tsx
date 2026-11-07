import type { Metadata } from "next";
import { Alert, Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { Schedule } from "@/lib/jobs/schedule";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { evaluateSystem, problemTone, type SystemProblem } from "@/server/jobs/health";
import { jobRunner } from "@/server/jobs";
import { activeFeatureSet } from "@/server/jobs/runner";
import { jobStatusRows, recentJobRuns } from "@/server/jobs/status";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("system.title") };
}

const TONE = { ok: "success", error: "danger", interrupted: "warning", running: "info" } as const;

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
      <PageHeader title={t("system.title")} description={t("system.description")} />
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

        <Card title={t("system.jobs.title")} padded={false}>
          {jobs.length === 0 ? (
            <EmptyState title={t("system.jobs.empty")} />
          ) : (
            <Table className="min-w-[56rem]">
              <thead>
                <tr>
                  <th>{t("system.jobs.cols.job")}</th>
                  <th>{t("system.jobs.cols.schedule")}</th>
                  <th>{t("system.jobs.cols.last")}</th>
                  <th>{t("system.jobs.cols.result")}</th>
                  <th>{t("system.jobs.cols.next")}</th>
                  <th>{t("system.jobs.cols.failures")}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const inactive = !!j.feature && !active.has(j.feature);
                  return (
                    <tr key={j.id}>
                      <td>{nameOf(j.id)}</td>
                      <td className="text-ink-muted">{scheduleText(j.schedule)}</td>
                      <td className="tabular whitespace-nowrap">
                        {j.running ? (
                          <Badge tone="info">{t("system.jobs.running")}</Badge>
                        ) : j.lastRunAt ? (
                          <span className="inline-flex items-center gap-2">
                            {when(j.lastRunAt)} <Badge tone={TONE[j.lastStatus as keyof typeof TONE] ?? "neutral"}>{td(`system.status.${j.lastStatus}`, j.lastStatus ?? "–")}</Badge>
                          </span>
                        ) : (
                          <span className="text-ink-muted">{t("system.jobs.never")}</span>
                        )}
                      </td>
                      <td className="max-w-64 break-words text-ink-muted">{j.lastMessage ?? "–"}</td>
                      <td className="tabular whitespace-nowrap text-ink-muted">{inactive ? t("system.jobs.inactive") : j.nextRunAt ? when(j.nextRunAt) : "–"}</td>
                      <td className="tabular">{j.failures > 0 ? <Badge tone="danger">{j.failures}</Badge> : "0"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

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

        <Card title={t("system.runs.title")} padded={false}>
          {runs.length === 0 ? (
            <EmptyState title={t("system.runs.empty")} />
          ) : (
            <Table className="min-w-[44rem]">
              <thead>
                <tr>
                  <th>{t("system.runs.cols.time")}</th>
                  <th>{t("system.runs.cols.job")}</th>
                  <th>{t("system.runs.cols.status")}</th>
                  <th>{t("system.runs.cols.duration")}</th>
                  <th>{t("system.runs.cols.message")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="tabular whitespace-nowrap">{when(r.startedAt)}</td>
                    <td>{nameOf(r.jobId)}</td>
                    <td>
                      <Badge tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{td(`system.status.${r.status}`, r.status)}</Badge>
                    </td>
                    <td className="tabular text-ink-muted">{duration(r.durationMs)}</td>
                    <td className="max-w-80 break-words text-ink-muted">{r.message ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
