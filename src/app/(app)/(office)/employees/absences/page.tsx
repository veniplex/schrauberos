import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, isSameDay, startOfDay } from "date-fns";
import { CalendarPlus, Trash2 } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { UrlModal } from "@/components/ui/modal";
import { getI18n } from "@/i18n/server";
import { nowDate, parseMonthParam, todayInput } from "@/lib/dates";
import { employeeName, visibleAbsenceType, workdaysBetween } from "@/modules/office/employees/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteAbsence } from "@/modules/office/employees/actions";
import { AbsenceForm } from "@/modules/office/employees/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.absences") };
}

const CELL = {
  vacation: "bg-info-ink/70",
  sick: "bg-danger-ink/75",
  training: "bg-accent",
  other: "bg-ink-muted/60",
  masked: "bg-ink-muted/40",
} as const;
const TYPE_TONE = { vacation: "info", sick: "danger", training: "accent", other: "neutral", masked: "neutral" } as const;

export default async function AbsencesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; new?: string; employee?: string; date?: string }>;
}) {
  const session = await requirePermission("employees.view");
  const [sp, i18n] = await Promise.all([searchParams, getI18n()]);
  const { t, tp, td, date } = i18n;
  const canEdit = session.can("employees.edit");
  const sensitive = session.can("employees.sensitive");

  const monthStart = parseMonthParam(sp.month);
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const monthKey = format(monthStart, "yyyy-MM");
  const base = `/employees/absences?month=${monthKey}`;

  const [employees, absences] = await Promise.all([
    db.employee.findMany({ where: { active: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    db.absence.findMany({
      where: { startDate: { lte: monthEnd }, endDate: { gte: monthStart } },
      include: { employee: true },
      orderBy: { startDate: "asc" },
    }),
  ]);
  const today = nowDate();

  const covering = (employeeId: string, day: Date) =>
    absences.find((a) => a.employeeId === employeeId && startOfDay(a.startDate) <= day && startOfDay(a.endDate) >= day);

  return (
    <>
      <PageHeader
        title={t("employees.absencesTitle")}
        description={t("employees.absencesDescription")}
        actions={
          canEdit ? (
            <LinkButton href={`${base}&new=1`} variant="primary">
              <CalendarPlus className="size-4" aria-hidden /> {t("employees.absenceNew")}
            </LinkButton>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={`/employees/absences?month=${format(addMonths(monthStart, -1), "yyyy-MM")}`} className="btn btn-secondary btn-icon" aria-label={t("common.previous")}>
            ‹
          </Link>
          <Link href="/employees/absences" className="btn btn-secondary">
            {t("common.today")}
          </Link>
          <Link href={`/employees/absences?month=${format(addMonths(monthStart, 1), "yyyy-MM")}`} className="btn btn-secondary btn-icon" aria-label={t("common.next")}>
            ›
          </Link>
        </div>
        <h2 className="text-base font-semibold">{date(monthStart, { month: "long", year: "numeric" })}</h2>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs text-ink-muted" aria-label={t("employees.legend")}>
          {(["vacation", ...(sensitive ? (["sick"] as const) : []), "training", "other"] as const).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className={clsx("size-3 rounded-sm", CELL[k])} /> {td(`employees.absenceTypes.${k}`, k)}
            </li>
          ))}
          {!sensitive ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className={clsx("size-3 rounded-sm", CELL.masked)} /> {t("employees.absent")}
            </li>
          ) : null}
        </ul>
      </div>

      <section className="card overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-40 border-b border-line bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">{t("employees.title")}</th>
              {days.map((d) => {
                const weekend = getDay(d) === 0 || getDay(d) === 6;
                return (
                  <th
                    key={d.toISOString()}
                    className={clsx("min-w-7 border-b border-l border-line px-0.5 py-1 text-center font-normal tabular", weekend ? "bg-surface-2 text-ink-muted" : "", isSameDay(d, today) && "font-bold text-accent-text")}
                  >
                    <span className="block text-[10px] uppercase">{date(d, { weekday: "narrow" })}</span>
                    {d.getDate()}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr>
                <td colSpan={days.length + 1}>
                  <EmptyState title={t("employees.empty")} />
                </td>
              </tr>
            ) : (
              employees.map((e) => (
                <tr key={e.id}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5 text-left font-medium">
                    <Link href={`/employees/${e.id}`} className="hover:underline">
                      {employeeName(e)}
                    </Link>
                  </th>
                  {days.map((d) => {
                    const a = covering(e.id, d);
                    const weekend = getDay(d) === 0 || getDay(d) === 6;
                    const type = a ? visibleAbsenceType(a.type, sensitive) : null;
                    return (
                      <td key={d.toISOString()} className={clsx("h-7 border-b border-l border-line p-0.5", weekend && "bg-surface-2")}>
                        {type ? (
                          <span
                            className={clsx("block h-full w-full rounded-sm", CELL[type])}
                            title={`${type === "masked" ? t("employees.absent") : td(`employees.absenceTypes.${type}`, type)}${a?.note && type !== "masked" && type !== "sick" ? ` – ${a.note}` : ""}`}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <div className="mt-5">
        <Card title={t("employees.absencesInMonth", { count: absences.length })} padded={false}>
          {absences.length === 0 ? (
            <EmptyState title={t("employees.noAbsencesMonth")} />
          ) : (
            <ul className="divide-y divide-line">
              {absences.map((a) => {
                const type = visibleAbsenceType(a.type, sensitive);
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/employees/${a.employeeId}`} className="font-medium hover:underline">
                        {employeeName(a.employee)}
                      </Link>
                      <Badge tone={TYPE_TONE[type]}>{type === "masked" ? t("employees.absent") : td(`employees.absenceTypes.${type}`, type)}</Badge>
                      <span className="tabular text-ink-muted">
                        {date(a.startDate)}
                        {a.endDate.getTime() !== a.startDate.getTime() ? ` – ${date(a.endDate)}` : ""} · {tp("employees.workdays", workdaysBetween(a.startDate, a.endDate))}
                      </span>
                    </span>
                    {canEdit && (a.type !== "sick" || sensitive) ? (
                      <form action={deleteAbsence}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="returnTo" value={base} />
                        <ConfirmSubmitButton message={t("employees.absenceDeleteConfirm")} aria-label={t("common.delete")}>
                          <Trash2 className="size-3.5" aria-hidden />
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {canEdit && sp.new ? (
        <UrlModal key={`${sp.employee ?? ""}-${sp.date ?? ""}`} title={t("employees.absenceNew")} closeHref={base}>
          <AbsenceForm
            employees={employees.map((e) => ({ id: e.id, name: employeeName(e) }))}
            initialEmployeeId={sp.employee ?? ""}
            initialDate={/^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayInput()}
            canSensitive={sensitive}
            returnTo={base}
            closeHref={base}
          />
        </UrlModal>
      ) : null}
    </>
  );
}
