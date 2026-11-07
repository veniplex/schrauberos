import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { Alert, Card, EmptyState, StatusBadge, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { isCalendarDay, todayInput } from "@/lib/dates";
import { addDaysToKey } from "@/lib/zone";
import { stampableOrders } from "@/modules/workshop/orders/public";
import { entryMinutes, formatDuration, weekDays } from "@/modules/office/time/domain";
import { HintList } from "@/modules/office/time/hint-list";
import { listEntries, myEmployee, runningEntry, weekFor } from "@/modules/office/time/queries";
import { StampPanel } from "@/modules/office/time/stamp-panel";
import { TimeTabs } from "@/modules/office/time/tabs";
import { WeekTable } from "@/modules/office/time/week-table";
import { requirePermission } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.time") };
}

/**
 * Zeiterfassung, Reiter „Heute“: Stempeln (großer Knopf), die heutigen Einträge und die Wochenübersicht Ist/Soll/Saldo mit den Pausen-/Ruhezeit-Hinweisen. Mit `time.view` sieht man nur die eigenen Zeiten.
 */
export default async function TimePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const session = await requirePermission("time.view");
  const [{ t, date, number }, sp] = await Promise.all([getI18n(), searchParams]);
  const mine = await myEmployee(session);
  const team = session.can("time.viewAll");

  const header = (
    <PageHeader
      title={t("time.title")}
      description={t("time.description")}
      help="office.time"
      actions={
        session.can("time.correct") && mine ? (
          <LinkButton href="/time/entries/new">
            <Plus className="size-4" aria-hidden /> {t("time.quick.manual")}
          </LinkButton>
        ) : null
      }
    />
  );

  if (!mine || !mine.active) {
    return (
      <>
        {header}
        <TimeTabs active="today" team={team} />
        <Alert tone="warning">{mine ? t("time.noProfile.inactive") : t("time.noProfile.none")}</Alert>
      </>
    );
  }

  const today = todayInput();
  const anyDay = sp.week && isCalendarDay(sp.week) ? sp.week : today;
  const now = new Date();
  const withOrders = session.features.has("workshop.orders") && session.can("orders.view");
  const [running, week, todays, orders, workshop] = await Promise.all([
    runningEntry(session),
    weekFor(mine, anyDay, now),
    listEntries(session, { from: today, to: today, employeeId: mine.id }),
    withOrders && session.can("time.stamp") ? stampableOrders() : Promise.resolve([]),
    getWorkshop(),
  ]);
  const prev = addDaysToKey(week.days[0], -7);
  const next = addDaysToKey(week.days[0], 7);
  const awText = (minutes: number) => t("time.aw", { aw: number(minutes / Math.max(1, workshop.workUnitMinutes), { maximumFractionDigits: 1 }) });
  const orderLabel = (e: { orderNumber: string | null; plate: string | null }) => (e.orderNumber ? [e.orderNumber, e.plate].filter(Boolean).join(" · ") : null);

  return (
    <>
      {header}
      <TimeTabs active="today" team={team} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {session.can("time.stamp") ? (
          <Card title={t("time.stamp.title")} className="lg:col-span-2">
            <StampPanel
              running={running ? { id: running.id, orderLabel: orderLabel(running) } : null}
              since={running ? date(running.startedAt, { timeStyle: "short" }) : null}
              orders={orders.map((o) => ({ id: o.id, label: `${o.number} · ${o.plate}` }))}
            />
          </Card>
        ) : null}

        <Card title={t("time.today.title")} padded={false}>
          {todays.length === 0 ? (
            <EmptyState title={t("time.today.empty")} />
          ) : (
            <ul className="divide-y divide-line">
              {todays.map((entry) => (
                <li key={entry.id}>
                  <TextLink href={`/time/entries/${entry.id}`} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-sm no-underline hover:bg-surface-hover">
                    <span className="min-w-0">
                      <span className="tabular font-medium">
                        {date(entry.startedAt, { timeStyle: "short" })} – {entry.endedAt ? date(entry.endedAt, { timeStyle: "short" }) : t("time.running")}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">{[orderLabel(entry), entry.activity].filter(Boolean).join(" · ") || t("time.general")}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="tabular">{formatDuration(entryMinutes(entry, now))}</span>
                      <span className="text-xs text-ink-muted">{awText(entryMinutes(entry, now))}</span>
                    </span>
                  </TextLink>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t("time.week.title")}
          padded={false}
          actions={
            <span className="flex items-center gap-1">
              <LinkButton href={`/time?week=${prev}`} size="icon-sm" variant="ghost" aria-label={t("time.week.previous")}>
                <ChevronLeft className="size-4" aria-hidden />
              </LinkButton>
              {week.days[0] !== weekDays(today)[0] ? (
                <LinkButton href="/time" size="sm" variant="ghost">
                  {t("time.week.current")}
                </LinkButton>
              ) : (
                <StatusBadge tone="info">{t("time.week.current")}</StatusBadge>
              )}
              <LinkButton href={`/time?week=${next}`} size="icon-sm" variant="ghost" aria-label={t("time.week.next")}>
                <ChevronRight className="size-4" aria-hidden />
              </LinkButton>
            </span>
          }
        >
          <WeekTable week={week.week} />
        </Card>

        {week.hints.length > 0 ? (
          <div className="lg:col-span-2">
            <HintList hints={week.hints} />
          </div>
        ) : null}
      </div>
    </>
  );
}
