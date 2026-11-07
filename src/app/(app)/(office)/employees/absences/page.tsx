import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Card, EmptyState, StatusBadge, Table, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { UrlModal } from "@/components/ui/modal";
import { getI18n } from "@/i18n/server";
import { isCalendarDay, nowDate, parseMonthParam, toDateInput, todayInput } from "@/lib/dates";
import { addMonths, eachDayOfInterval, endOfMonth, getDate, getDay, isSameDay, monthKeyOf, startOfDay } from "@/lib/zone";
import { getHolidays } from "@/server/holidays";
import { employeeName, workdaysBetween } from "@/modules/office/employees/domain";
import { absencesOverlapping, activeEmployees, getAbsenceForEdit, staffWorkPatterns } from "@/modules/office/employees/queries";
import { parseWorkWeekdays } from "@/modules/office/employees/work-pattern";
import { requirePermission } from "@/server/auth/session";
import { deleteAbsence } from "@/modules/office/employees/actions";
import { AbsenceForm } from "@/modules/office/employees/forms";
import { ABSENCE_TONE } from "@/modules/office/employees/status-tone";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.absences") };
}

/** Zellenfarben: Fläche und Schrift aus den Statustönen (gesicherter Kontrast); die Art steht zusätzlich als Kürzel in der Zelle, nie nur als Farbe. */
const CELL = {
  vacation: "bg-info-bg text-info-ink",
  sick: "bg-danger-bg text-danger-ink",
  training: "bg-accent-subtle text-accent-text",
  other: "bg-surface-2 text-ink",
  masked: "bg-surface-2 text-ink-muted",
} as const;

export default async function AbsencesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; new?: string; employee?: string; date?: string; edit?: string }>;
}) {
  const session = await requirePermission("employees.view");
  const [sp, i18n] = await Promise.all([searchParams, getI18n()]);
  const { t, tp, td, date, number } = i18n;
  const holidays = await getHolidays();
  const canEdit = session.can("employees.edit");
  const sensitive = session.can("employees.sensitive");

  const monthStart = parseMonthParam(sp.month);
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const monthKey = monthKeyOf(monthStart);
  const base = `/employees/absences?month=${monthKey}`;

  const [employees, absences, patterns, editing] = await Promise.all([
    activeEmployees(),
    // Krankheit ohne `employees.sensitive`: Art und Anmerkung werden gar nicht gelesen (type = "masked")
    absencesOverlapping(session, monthStart, monthEnd),
    // Arbeitstage-Muster (Teilzeit): freie Tage der Person erscheinen im Raster wie das Wochenende
    staffWorkPatterns(session),
    canEdit && sp.edit ? getAbsenceForEdit(session, sp.edit) : null,
  ]);
  const today = nowDate();

  const covering = (employeeId: string, day: Date) =>
    absences.find((a) => a.employeeId === employeeId && startOfDay(a.startDate) <= day && startOfDay(a.endDate) >= day);

  return (
    <>
      <PageHeader
        title={t("employees.absencesTitle")}
        description={t("employees.absencesDescription")}
        back={{ href: "/employees", label: t("employees.title") }}
        help="office.employees"
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
          <LinkButton size="icon" href={`/employees/absences?month=${monthKeyOf(addMonths(monthStart, -1))}`} aria-label={t("common.previous")}>
            <ChevronLeft className="size-4" aria-hidden />
          </LinkButton>
          <LinkButton href="/employees/absences">
            {t("common.today")}
          </LinkButton>
          <LinkButton size="icon" href={`/employees/absences?month=${monthKeyOf(addMonths(monthStart, 1))}`} aria-label={t("common.next")}>
            <ChevronRight className="size-4" aria-hidden />
          </LinkButton>
        </div>
        <h2 className="text-base font-semibold">{date(monthStart, { month: "long", year: "numeric" })}</h2>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs text-ink-muted" aria-label={t("employees.legend")}>
          {(["vacation", ...(sensitive ? (["sick"] as const) : []), "training", "other"] as const).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className={clsx("grid size-5 place-items-center rounded-sm text-xs font-semibold", CELL[k])}>
                {t(`employees.absenceAbbr.${k}`)}
              </span>{" "}
              {td(`employees.absenceTypes.${k}`, k)}
            </li>
          ))}
          {!sensitive ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className={clsx("grid size-5 place-items-center rounded-sm text-xs font-semibold", CELL.masked)}>
                {t("employees.absenceAbbr.masked")}
              </span>{" "}
              {t("employees.absent")}
            </li>
          ) : null}
        </ul>
      </div>

      {/* Mobil-Regel: Das Monatsraster braucht Breite – unter md gibt es stattdessen die Liste „Einträge in diesem Monat“ (und „Abwesenheit eintragen“) */}
      <Card padded={false} className="max-md:hidden">
        <Table variant="grid" caption={t("employees.absencesTitle")}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-40 border-b border-line bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">
                {t("employees.title")}
              </th>
              {days.map((d) => {
                const weekend = getDay(d) === 0 || getDay(d) === 6;
                return (
                  <th
                    key={d.toISOString()}
                    scope="col"
                    className={clsx("min-w-[max(1.75rem,var(--tap-row))] border-b border-l border-line px-0.5 py-1 text-center font-normal tabular", weekend ? "bg-surface-2 text-ink-muted" : "", isSameDay(d, today) && "font-bold text-accent-text")}
                  >
                    <span className="block text-xs uppercase">{date(d, { weekday: "narrow" })}</span>
                    {getDate(d)}
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
                    <TextLink href={`/employees/${e.id}`} className="text-inherit no-underline hover:underline">
                      {employeeName(e)}
                    </TextLink>
                  </th>
                  {days.map((d) => {
                    const a = covering(e.id, d);
                    const weekend = !parseWorkWeekdays(patterns.get(e.id)).has(getDay(d));
                    const type = a ? a.type : null;
                    const label = type ? (type === "masked" ? t("employees.absent") : td(`employees.absenceTypes.${type}`, type)) : "";
                    const key = toDateInput(d);
                    return (
                      <td key={key} className={clsx("h-7 border-b border-l border-line p-0.5", weekend && "bg-surface-2")}>
                        {type ? (
                          <span
                            className={clsx("grid h-full min-h-(--tap-row) w-full place-items-center rounded-sm text-xs font-semibold", CELL[type])}
                            title={`${label}${a?.note && type !== "masked" && type !== "sick" ? ` – ${a.note}` : ""}`}
                          >
                            <span aria-hidden>{t(`employees.absenceAbbr.${type}`)}</span>
                            <span className="sr-only">{label}</span>
                          </span>
                        ) : canEdit ? (
                          // Die Matrixzelle öffnet das Formular vorbelegt (Mitarbeiter und Tag). Nur ein Mausweg: per Tastatur und Screenreader gibt es „Abwesenheit eintragen“.
                          <Link
                            href={`${base}&new=1&employee=${e.id}&date=${key}`}
                            prefetch={false}
                            tabIndex={-1}
                            aria-hidden
                            className="block h-full min-h-(--tap-row) w-full rounded-sm hover:bg-accent-subtle"
                            title={t("employees.absenceEnterFor", { name: employeeName(e), date: date(d) })}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <div className="mt-5">
        <Card title={t("employees.absencesInMonth", { count: absences.length })} padded={false}>
          {absences.length === 0 ? (
            <EmptyState title={t("employees.noAbsencesMonth")} />
          ) : (
            <ul className="divide-y divide-line">
              {absences.map((a) => {
                const type = a.type;
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <TextLink href={`/employees/${a.employeeId}`} className="font-medium text-inherit no-underline hover:underline">
                        {employeeName(a.employee)}
                      </TextLink>
                      <StatusBadge tone={ABSENCE_TONE[type]}>{type === "masked" ? t("employees.absent") : td(`employees.absenceTypes.${type}`, type)}</StatusBadge>
                      <span className="tabular text-ink-muted">
                        {date(a.startDate)}
                        {a.endDate.getTime() !== a.startDate.getTime() ? ` – ${date(a.endDate)}` : ""} · {tp("employees.workdays", workdaysBetween(a.startDate, a.endDate, holidays, undefined, parseWorkWeekdays(a.employee.workWeekdays)), { count: number(workdaysBetween(a.startDate, a.endDate, holidays, undefined, parseWorkWeekdays(a.employee.workWeekdays))) })}
                      </span>
                    </span>
                    {canEdit && a.type !== "masked" ? (
                      <span className="flex items-center gap-1">
                        <LinkButton size="icon-sm" href={`${base}&edit=${a.id}`} aria-label={`${t("common.edit")}: ${employeeName(a.employee)}, ${date(a.startDate)}`} title={t("common.edit")}>
                          <Pencil className="size-3.5" aria-hidden />
                        </LinkButton>
                        <form action={deleteAbsence}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="returnTo" value={base} />
                          <ConfirmSubmitButton message={t("employees.absenceDeleteConfirm")} target={`${employeeName(a.employee)}, ${date(a.startDate)}`} label={t("common.delete")}>
                            <Trash2 className="size-3.5" aria-hidden />
                          </ConfirmSubmitButton>
                        </form>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {editing ? (
        <UrlModal key={editing.id} title={t("employees.absenceEdit")} closeHref={base}>
          <AbsenceForm
            employees={employees.map((e) => ({ id: e.id, name: employeeName(e) }))}
            initialEmployeeId={editing.employeeId}
            initialDate={toDateInput(editing.startDate)}
            canSensitive={sensitive}
            returnTo={base}
            closeHref={base}
            edit={{ id: editing.id, version: editing.version, type: editing.type, startDate: toDateInput(editing.startDate), endDate: toDateInput(editing.endDate), note: editing.note ?? "" }}
          />
        </UrlModal>
      ) : null}

      {canEdit && sp.new && !editing ? (
        <UrlModal key={`${sp.employee ?? ""}-${sp.date ?? ""}`} title={t("employees.absenceNew")} closeHref={base}>
          <AbsenceForm
            employees={employees.map((e) => ({ id: e.id, name: employeeName(e) }))}
            initialEmployeeId={sp.employee ?? ""}
            initialDate={isCalendarDay(sp.date ?? "") ? sp.date! : todayInput()}
            canSensitive={sensitive}
            returnTo={base}
            closeHref={base}
          />
        </UrlModal>
      ) : null}
    </>
  );
}
