import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { DateRange } from "@/components/ui/date-range";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { Alert, EmptyState, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { isCalendarDay, todayInput } from "@/lib/dates";
import { staffWithAccountIds } from "@/modules/office/employees/public";
import { entryMinutes, formatDuration, hintsFor } from "@/modules/office/time/domain";
import { HintList } from "@/modules/office/time/hint-list";
import { listEntries, myEmployee } from "@/modules/office/time/queries";
import { TimeTabs } from "@/modules/office/time/tabs";
import { requirePermission } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("time.tabs.entries") };
}

/**
 * Zeiterfassung, Reiter „Einträge“: die Zeiten im gewählten Zeitraum (Standard: dieser Monat) – eigene, mit `time.viewAll` die aller Mitarbeiter (Filter „Mitarbeiter“). Jede Zeile führt zum Eintrag mit
 * Korrekturverlauf; stornierte Einträge lassen sich einblenden. Die Pausen-/Ruhezeit-Hinweise gelten für die eigenen Einträge im Zeitraum.
 */
export default async function EntriesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; employee?: string; voided?: string }> }) {
  const session = await requirePermission("time.view");
  const [{ t, date, number }, sp] = await Promise.all([getI18n(), searchParams]);
  const today = todayInput();
  const from = sp.from && isCalendarDay(sp.from) ? sp.from : `${today.slice(0, 8)}01`;
  const to = sp.to && isCalendarDay(sp.to) && sp.to >= from ? sp.to : today;
  const team = session.can("time.viewAll");
  const mine = await myEmployee(session);
  const includeVoided = sp.voided === "1";
  const [rows, staff, workshop] = await Promise.all([
    listEntries(session, { from, to, employeeId: team && sp.employee ? sp.employee : undefined, includeVoided }),
    team ? staffWithAccountIds() : Promise.resolve([]),
    getWorkshop(),
  ]);
  const now = new Date();
  const own = rows.filter((r) => r.own && !r.voided);
  const hints = hintsFor(own, now).filter((h) => h.day >= from && h.day <= to);
  const aw = (minutes: number) => number(minutes / Math.max(1, workshop.workUnitMinutes), { maximumFractionDigits: 1 });
  const total = rows.filter((r) => !r.voided && r.endedAt).reduce((sum, r) => sum + entryMinutes(r, now), 0);

  return (
    <>
      <PageHeader
        title={t("time.tabs.entries")}
        description={t("time.entriesDescription")}
        help="office.time"
        actions={
          session.can("time.correct") && mine ? (
            <LinkButton href="/time/entries/new">
              <Plus className="size-4" aria-hidden /> {t("time.quick.manual")}
            </LinkButton>
          ) : null
        }
      />
      <TimeTabs active="entries" team={team} />

      <FilterBar
        columns={team ? "sm:grid-cols-[minmax(0,1fr)_14rem_auto]" : "sm:grid-cols-[minmax(0,1fr)_auto]"}
        active={Boolean(sp.from || sp.to || sp.employee || includeVoided)}
        resetHref="/time/entries"
        search={<DateRange today={today} defaultFrom={from} defaultTo={to} presets={["today", "last7", "last30", "thisMonth", "lastMonth"]} maxDays={366} />}
      >
        {team ? (
          <Select name="employee" defaultValue={sp.employee ?? ""} aria-label={t("time.fields.employee")}>
            <option value="">{t("time.allEmployees")}</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select name="voided" defaultValue={includeVoided ? "1" : ""} aria-label={t("time.fields.voided")}>
          <option value="">{t("time.voidedHide")}</option>
          <option value="1">{t("time.voidedShow")}</option>
        </Select>
      </FilterBar>

      {hints.length > 0 ? (
        <div className="mb-5">
          <HintList hints={hints} />
        </div>
      ) : null}
      {!mine && !team ? <Alert tone="warning">{t("time.noProfile.none")}</Alert> : null}

      <DataTable
        caption={t("time.tabs.entries")}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/time/entries/${r.id}`}
        minWidth="46rem"
        summary={t("time.entriesSummary", { count: rows.length, total: formatDuration(total) })}
        empty={<EmptyState title={t("time.entriesEmpty")} hint={t("time.entriesEmptyHint")} />}
        columns={[
          {
            id: "when",
            header: t("time.cols.when"),
            priority: "primary",
            cell: (r) => (
              <span className="tabular font-medium">
                {date(r.startedAt, { dateStyle: "medium" })} · {date(r.startedAt, { timeStyle: "short" })} – {r.endedAt ? date(r.endedAt, { timeStyle: "short" }) : t("time.running")}
              </span>
            ),
          },
          ...(team ? [{ id: "employee", header: t("time.cols.employee"), cell: (r: (typeof rows)[number]) => r.employeeName ?? (r.own ? t("time.me") : "–") }] : []),
          { id: "what", header: t("time.cols.what"), cell: (r) => [r.orderNumber, r.plate, r.activity].filter(Boolean).join(" · ") || <span className="text-ink-muted">{t("time.general")}</span> },
          {
            id: "duration",
            header: t("time.cols.duration"),
            align: "end",
            cell: (r) => (
              <span className="tabular">
                {formatDuration(entryMinutes(r, now))} <span className="text-xs text-ink-muted">· {t("time.aw", { aw: aw(entryMinutes(r, now)) })}</span>
              </span>
            ),
          },
          {
            id: "flags",
            header: t("time.cols.state"),
            priority: "low",
            cell: (r) => (
              <span className="flex flex-wrap gap-1">
                {r.voided ? <StatusBadge tone="danger">{t("time.flags.voided")}</StatusBadge> : null}
                {!r.endedAt && !r.voided ? <StatusBadge tone="info">{t("time.running")}</StatusBadge> : null}
                {r.source === "manual" ? <StatusBadge tone="neutral">{t("time.flags.manual")}</StatusBadge> : null}
                {r.transferred ? <StatusBadge tone="success">{t("time.flags.transferred")}</StatusBadge> : null}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
