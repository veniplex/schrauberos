import Link from "next/link";
import { Badge, Card, EmptyState, TextLink, StatusBadge } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { DUE_TONE, dueState } from "@/lib/due";
import { addDays, startOfDay } from "@/lib/zone";
import { employeeName } from "@/modules/office/employees/domain";
import { absencesAround, expiringQualifications } from "@/modules/office/employees/queries";
import { getSession } from "@/server/auth/session";
import type { WidgetDef } from "@/modules/types";

/** Heute abwesende Mitarbeiter und bald ablaufende Qualifikationen. */
export async function EmployeesWidget() {
  const [{ t, td, date }, session] = await Promise.all([getI18n(), getSession()]);
  if (!session) return null;
  const today = startOfDay(new Date());
  const soon = addDays(today, 60);

  const [absent, qualifications] = await Promise.all([
    // Krankheit ohne `employees.sensitive`: Art und Anmerkung werden gar nicht gelesen (type = "masked")
    absencesAround(session, today, addDays(today, 1)),
    expiringQualifications(session, soon, 6),
  ]);

  return (
    <Card headingLevel={3} title={t("employees.widgets.title")} actions={<TextLink href="/employees/absences" className="text-sm">{t("nav.absences")}</TextLink>} padded={false}>
      <h3 className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("employees.widgets.absentToday")}</h3>
      {absent.length === 0 ? (
        <p className="px-5 py-3 text-sm text-ink-muted">{t("employees.widgets.nobodyAbsent")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {absent.map((a) => {
            const type = a.type;
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
                  <StatusBadge tone={state ? DUE_TONE[state] : "neutral"}>
                    {state === "expired" ? t("employees.expired") : t("employees.validUntil")} {date(q.expiresAt!)}
                  </StatusBadge>
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
  { id: "employees-overview", titleKey: "employees.widgets.title", priority: 40, feature: "office.employees", permission: "employees.view", span: 1, order: 40, Component: EmployeesWidget },
];
