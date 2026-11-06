import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import { Badge, Card, EmptyState } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { DUE_TONE, dueState } from "@/lib/due";
import { employeeName, visibleAbsenceType } from "@/modules/office/employees/domain";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db";
import type { WidgetDef } from "@/modules/types";

/** Heute abwesende Mitarbeiter und bald ablaufende Qualifikationen. */
export async function EmployeesWidget() {
  const [{ t, td, date }, session] = await Promise.all([getI18n(), getSession()]);
  const sensitive = session?.can("employees.sensitive") ?? false;
  const today = startOfDay(new Date());
  const soon = addDays(today, 60);

  const [absent, qualifications] = await Promise.all([
    db.absence.findMany({
      where: { startDate: { lte: addDays(today, 1) }, endDate: { gte: today } },
      include: { employee: true },
      orderBy: { endDate: "asc" },
    }),
    db.qualification.findMany({
      where: { expiresAt: { not: null, lte: soon }, employee: { is: { active: true } } },
      include: { employee: true },
      orderBy: { expiresAt: "asc" },
      take: 6,
    }),
  ]);

  return (
    <Card title={t("employees.widgets.title")} actions={<Link href="/employees/absences" className="text-sm text-accent-text inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">{t("nav.absences")}</Link>} padded={false}>
      <h3 className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("employees.widgets.absentToday")}</h3>
      {absent.length === 0 ? (
        <p className="px-5 py-3 text-sm text-ink-muted">{t("employees.widgets.nobodyAbsent")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {absent.map((a) => {
            const type = visibleAbsenceType(a.type, sensitive);
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <Link href={`/employees/${a.employeeId}`} className="font-medium inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                  {employeeName(a.employee)}
                </Link>
                <span className="flex items-center gap-2">
                  <Badge>{type === "masked" ? t("employees.absent") : td(`employees.absenceTypes.${type}`, type)}</Badge>
                  <span className="text-xs text-ink-muted tabular">{t("employees.widgets.until", { date: date(a.endDate) })}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="border-t border-line px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("employees.widgets.qualifications")}</h3>
      {qualifications.length === 0 ? (
        <EmptyState title={t("employees.widgets.noQualifications")} />
      ) : (
        <ul className="divide-y divide-line">
          {qualifications.map((q) => {
            const state = dueState(q.expiresAt);
            return (
              <li key={q.id}>
                <Link href={`/employees/${q.employeeId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-hover">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{q.name}</span>
                    <span className="text-xs text-ink-muted">{employeeName(q.employee)}</span>
                  </span>
                  <Badge tone={state ? DUE_TONE[state] : "neutral"}>
                    {state === "expired" ? t("employees.expired") : t("employees.validUntil")} {date(q.expiresAt!)}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [
  { id: "employees-overview", feature: "office.employees", permission: "employees.view", span: 1, order: 40, Component: EmployeesWidget },
];
