import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { isCalendarDay, noon, todayInput } from "@/lib/dates";
import { addDaysToKey } from "@/lib/zone";
import { formatDuration } from "@/modules/office/time/domain";
import { teamWeek } from "@/modules/office/time/queries";
import { TimeTabs } from "@/modules/office/time/tabs";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("time.tabs.team") };
}

/** Zeiterfassung, Reiter „Team“ (nur mit `time.viewAll`): je Mitarbeiter Ist/Soll/Saldo der Woche, wer gerade stempelt und wie viele Hinweise anliegen. */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const session = await requirePermission("time.viewAll");
  const [{ t, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const anyDay = sp.week && isCalendarDay(sp.week) ? sp.week : todayInput();
  const { days, rows } = await teamWeek(session, anyDay);
  const signed = (minutes: number) => (minutes > 0 ? `+${formatDuration(minutes)}` : formatDuration(minutes));

  return (
    <>
      <PageHeader
        title={t("time.tabs.team")}
        description={t("time.teamDescription")}
        help="office.time"
        actions={
          <span className="flex items-center gap-1">
            <LinkButton href={`/time/team?week=${addDaysToKey(days[0], -7)}`} size="icon-sm" variant="ghost" aria-label={t("time.week.previous")}>
              <ChevronLeft className="size-4" aria-hidden />
            </LinkButton>
            <span className="tabular px-1 text-sm">
              {date(noon(days[0]), { day: "2-digit", month: "2-digit" })} – {date(noon(days[6]), { day: "2-digit", month: "2-digit", year: "numeric" })}
            </span>
            <LinkButton href={`/time/team?week=${addDaysToKey(days[0], 7)}`} size="icon-sm" variant="ghost" aria-label={t("time.week.next")}>
              <ChevronRight className="size-4" aria-hidden />
            </LinkButton>
          </span>
        }
      />
      <TimeTabs active="team" team />

      <DataTable
        caption={t("time.tabs.team")}
        rows={rows}
        rowKey={(r) => r.employeeId}
        rowHref={(r) => `/time/entries?employee=${r.employeeId}`}
        minWidth="40rem"
        empty={<EmptyState title={t("time.teamEmpty")} hint={t("time.teamEmptyHint")} />}
        columns={[
          { id: "name", header: t("time.cols.employee"), priority: "primary", cell: (r) => <span className="font-medium">{r.name}</span> },
          {
            id: "now",
            header: t("time.cols.now"),
            cell: (r) =>
              r.running ? (
                <StatusBadge tone="info">{t("time.team.runningSince", { since: date(r.running.since, { timeStyle: "short" }) })}{r.running.orderNumber ? ` · ${r.running.orderNumber}` : ""}</StatusBadge>
              ) : (
                <span className="text-ink-muted">–</span>
              ),
          },
          { id: "worked", header: t("time.week.worked"), align: "end", cell: (r) => <span className="tabular">{formatDuration(r.worked)}</span> },
          { id: "target", header: t("time.week.target"), align: "end", priority: "low", cell: (r) => <span className="tabular">{formatDuration(r.target)}</span> },
          { id: "balance", header: t("time.week.balance"), align: "end", cell: (r) => <span className="tabular">{signed(r.balance)}</span> },
          { id: "hints", header: t("time.cols.hints"), align: "end", priority: "low", cell: (r) => (r.hints > 0 ? <StatusBadge tone="warning">{r.hints}</StatusBadge> : <span className="text-ink-muted">–</span>) },
        ]}
      />
    </>
  );
}
