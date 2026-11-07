import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { Badge, Card, DefinitionList, EmptyState, TextLink, StatusBadge, DangerZone } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { currentYear } from "@/lib/dates";
import { DUE_TONE, dueState } from "@/lib/due";
import { ABSENCE_TONE } from "@/modules/office/employees/status-tone";
import { getHolidays } from "@/server/holidays";
import { employeeName, workdaysBetween, workdaysWithinKeys } from "@/modules/office/employees/domain";
import { employeeTitle, getEmployeeDetail } from "@/modules/office/employees/queries";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { deleteAbsence, deleteEmployee, deleteQualification } from "@/modules/office/employees/actions";
import { QualificationForm } from "@/modules/office/employees/forms";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("employees.view"))) return {};
  const e = await employeeTitle(id);
  return { title: e ? employeeName(e) : undefined };
}


export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("employees.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, tp, td, date, number } = i18n;
  const holidays = await getHolidays();
  const canEdit = session.can("employees.edit");
  const year = currentYear();

  // Notfallkontakt (`e.emergency`) und Art/Anmerkung von Krankheit kommen nur mit `employees.sensitive` aus der Datenbank (queries.ts)
  const e = await getEmployeeDetail(session, id);
  if (!e) notFound();

  const vacationUsed = e.absences.filter((a) => a.type === "vacation").reduce((n, a) => n + workdaysWithinKeys(a, `${year}-01-01`, `${year}-12-31`, holidays), 0);
  const returnTo = `/employees/${e.id}`;

  return (
    <>
      <PageHeader
        back={{ href: "/employees", label: t("nav.employees") }} help="office.employees"
        title={employeeName(e)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {e.jobTitle ? <span>{e.jobTitle}</span> : null}
            <Badge>{td(`employees.departments.${e.department}`, e.department)}</Badge>
            {!e.active ? <StatusBadge tone="warning">{t("employees.inactive")}</StatusBadge> : null}
          </span>
        }
        actions={
          canEdit ? (
            <LinkButton href={`/employees/${e.id}/edit`}>
              <Pencil className="size-4" aria-hidden /> {t("common.edit")}
            </LinkButton>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-5 md:col-span-2">
          <Card
            title={t("employees.sections.absences")}
            padded={false}
            actions={
              canEdit ? (
                <LinkButton size="sm" href={`/employees/absences?new=1&employee=${e.id}`}>
                  <CalendarPlus className="size-3.5" aria-hidden /> {t("employees.absenceNew")}
                </LinkButton>
              ) : null
            }
          >
            {e.vacationDaysPerYear != null ? (
              <p className="border-b border-line px-5 py-3 text-sm">
                {t("employees.vacationSummary", { year, used: number(vacationUsed), total: e.vacationDaysPerYear, left: number(e.vacationDaysPerYear - vacationUsed) })}
                <span className="block text-xs text-ink-muted">{t("employees.vacationNote")}</span>
              </p>
            ) : null}
            {e.absences.length === 0 ? (
              <EmptyState title={t("employees.noAbsences")} />
            ) : (
              <ul className="divide-y divide-line">
                {e.absences.map((a) => {
                  const type = a.type;
                  const days = workdaysBetween(a.startDate, a.endDate, holidays);
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={ABSENCE_TONE[type]}>{type === "masked" ? t("employees.absent") : td(`employees.absenceTypes.${type}`, type)}</StatusBadge>
                        <span className="tabular">
                          {date(a.startDate)}
                          {a.endDate.getTime() !== a.startDate.getTime() ? ` – ${date(a.endDate)}` : ""}
                        </span>
                        <span className="text-ink-muted">({tp("employees.workdays", days, { count: number(days) })})</span>
                        {a.note && type !== "masked" && type !== "sick" ? <span className="text-ink-muted">{a.note}</span> : null}
                      </span>
                      {canEdit && a.type !== "masked" ? (
                        <form action={deleteAbsence}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <ConfirmSubmitButton message={t("employees.absenceDeleteConfirm")} target={date(a.startDate)} label={t("common.delete")}>
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

          <Card title={t("employees.sections.qualifications")} padded={false}>
            {e.qualifications.length === 0 ? (
              <EmptyState title={t("employees.noQualifications")} />
            ) : (
              <ul className="divide-y divide-line">
                {e.qualifications.map((q) => {
                  const state = dueState(q.expiresAt);
                  return (
                    <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="font-medium">{q.name}</span>
                      <span className="flex items-center gap-3">
                        {q.expiresAt ? (
                          <StatusBadge tone={state ? DUE_TONE[state] : "neutral"}>
                            {state === "expired" ? t("employees.expired") : t("employees.validUntil")} {date(q.expiresAt)}
                          </StatusBadge>
                        ) : (
                          <span className="text-ink-muted">{t("employees.noExpiry")}</span>
                        )}
                        {canEdit ? (
                          <form action={deleteQualification}>
                            <input type="hidden" name="id" value={q.id} />
                            <ConfirmSubmitButton message={t("employees.qualificationDeleteConfirm")} target={q.name} label={t("common.delete")}>
                              <Trash2 className="size-3.5" aria-hidden />
                            </ConfirmSubmitButton>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit ? (
              <div className="border-t border-line px-5 py-4">
                <QualificationForm employeeId={e.id} />
              </div>
            ) : null}
          </Card>
        </div>

        <div className="min-w-0 flex flex-col gap-5">
          <Card title={t("employees.sections.person")}>
            <DefinitionList
              items={[
                { label: t("employees.fields.personnelNumber"), value: e.personnelNumber },
                { label: t("customers.fields.email"), value: e.email ? <TextLink external href={`mailto:${e.email}`}>{e.email}</TextLink> : null },
                { label: t("customers.fields.phone"), value: e.phone },
                { label: t("employees.fields.mobile"), value: e.mobile },
                { label: t("employees.fields.hireDate"), value: e.hireDate ? date(e.hireDate) : null },
                { label: t("employees.fields.leaveDate"), value: e.leaveDate ? date(e.leaveDate) : null },
                { label: t("common.notes"), value: e.notes },
              ]}
            />
          </Card>

          <Card title={t("employees.fields.userAccount")}>
            {e.user ? (
              <p className="text-sm">
                {session.can("users.manage") ? (
                  <TextLink href={`/admin/users/${e.user.id}`} className="font-medium">
                    {e.user.name}
                  </TextLink>
                ) : (
                  <span className="font-medium">{e.user.name}</span>
                )}{" "}
                <span className="text-ink-muted">({e.user.username})</span>
                {!e.user.active ? <StatusBadge tone="warning" className="ml-2">{t("users.inactive")}</StatusBadge> : null}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">{t("employees.noUserLinked")}</p>
            )}
          </Card>

          {e.emergency ? (
            <Card title={t("employees.sections.emergency")}>
              <DefinitionList
                items={[
                  { label: t("employees.fields.emergencyName"), value: e.emergency.name },
                  { label: t("employees.fields.emergencyPhone"), value: e.emergency.phone },
                  { label: t("employees.fields.emergencyRelation"), value: e.emergency.relation },
                ]}
              />
            </Card>
          ) : null}

          {session.can("employees.delete") ? (
            <DangerZone title={t("common.dangerZone")}>
              <form action={deleteEmployee}>
                <input type="hidden" name="id" value={e.id} />
                <ConfirmSubmitButton message={t("employees.confirmDelete", { name: employeeName(e) })}>{t("employees.delete")}</ConfirmSubmitButton>
              </form>
            </DangerZone>
          ) : null}
        </div>
      </div>
    </>
  );
}
