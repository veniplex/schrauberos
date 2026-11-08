import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { monthKeyOf } from "@/lib/zone";
import { Badge, Card, DefinitionList, EmptyState, TextLink, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { currentYear, toDateInput } from "@/lib/dates";
import { DUE_TONE, dueState } from "@/lib/due";
import { ABSENCE_TONE } from "@/modules/office/employees/status-tone";
import { getHolidays } from "@/server/holidays";
import { employeeDeletable, employeeName, workdaysBetween } from "@/modules/office/employees/domain";
import { employeeDeletionDeps, employeeTitle, getEmployeeDetail, getQualificationForEdit, getVacationBalance } from "@/modules/office/employees/queries";
import { VacationSummary } from "@/modules/office/employees/vacation-summary";
import { parseWorkWeekdays } from "@/modules/office/employees/work-pattern";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { deleteAbsence, deleteEmployee, deleteQualification } from "@/modules/office/employees/actions";
import { QualificationForm } from "@/modules/office/employees/forms";
import { ArchivePanel } from "@/components/archive/archive-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("employees.view"))) return {};
  const e = await employeeTitle(id);
  return { title: e ? employeeName(e) : undefined };
}


export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ editQualification?: string }> }) {
  const session = await requirePermission("employees.view");
  const [{ id }, sp, i18n] = await Promise.all([params, searchParams, getI18n()]);
  const { t, tp, td, date, number } = i18n;
  const holidays = await getHolidays();
  const canEdit = session.can("employees.edit");
  const year = currentYear();

  // Notfallkontakt (`e.emergency`) und Art/Anmerkung von Krankheit kommen nur mit `employees.sensitive` aus der Datenbank (queries.ts)
  const e = await getEmployeeDetail(session, id);
  if (!e) notFound();

  // Urlaubsstand: Anspruch (anteilig im Ein-/Austrittsjahr), Übertrag, genommen (alle Urlaubseinträge des Jahres, nicht nur die angezeigten), Rest
  const balance = e.vacationDaysPerYear != null || e.vacationCarryYear != null ? await getVacationBalance(session, id, year) : null;
  const pattern = parseWorkWeekdays(e.workWeekdays);
  const editingQualification = canEdit && sp.editQualification ? await getQualificationForEdit(session, sp.editQualification) : null;
  const returnTo = `/employees/${e.id}`;
  const deletionDeps = session.can("employees.delete") ? await employeeDeletionDeps(e.id) : null;

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
            {balance ? <VacationSummary balance={balance} workWeekdays={e.workWeekdays} /> : null}
            {e.absences.length === 0 ? (
              <EmptyState title={t("employees.noAbsences")} />
            ) : (
              <ul className="divide-y divide-line">
                {e.absences.map((a) => {
                  const type = a.type;
                  const days = workdaysBetween(a.startDate, a.endDate, holidays, undefined, pattern);
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
                        <span className="flex items-center gap-1">
                          <LinkButton size="icon-sm" href={`/employees/absences?month=${monthKeyOf(a.startDate)}&edit=${a.id}`} aria-label={`${t("common.edit")}: ${date(a.startDate)}`} title={t("common.edit")}>
                            <Pencil className="size-3.5" aria-hidden />
                          </LinkButton>
                          <form action={deleteAbsence}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <ConfirmSubmitButton message={t("employees.absenceDeleteConfirm")} target={date(a.startDate)} label={t("common.delete")}>
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
                          <span className="flex items-center gap-1">
                            <LinkButton size="icon-sm" href={`/employees/${e.id}?editQualification=${q.id}`} aria-label={`${t("common.edit")}: ${q.name}`} title={t("common.edit")}>
                              <Pencil className="size-3.5" aria-hidden />
                            </LinkButton>
                            <form action={deleteQualification}>
                              <input type="hidden" name="id" value={q.id} />
                              <ConfirmSubmitButton message={t("employees.qualificationDeleteConfirm")} target={q.name} label={t("common.delete")}>
                                <Trash2 className="size-3.5" aria-hidden />
                              </ConfirmSubmitButton>
                            </form>
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit ? (
              <div className="border-t border-line px-5 py-4">
                {editingQualification && editingQualification.employeeId === e.id ? (
                  <>
                    <p className="mb-3 text-sm font-medium">{t("employees.qualificationEdit")}</p>
                    <QualificationForm
                      key={editingQualification.id}
                      employeeId={e.id}
                      cancelHref={returnTo}
                      edit={{
                        id: editingQualification.id,
                        version: editingQualification.version,
                        name: editingQualification.name,
                        issuedAt: editingQualification.issuedAt ? toDateInput(editingQualification.issuedAt) : "",
                        expiresAt: editingQualification.expiresAt ? toDateInput(editingQualification.expiresAt) : "",
                        note: editingQualification.note ?? "",
                      }}
                    />
                  </>
                ) : (
                  <QualificationForm employeeId={e.id} />
                )}
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

          {deletionDeps ? (
            <ArchivePanel
              id={e.id}
              archived={false}
              deps={[
                { kind: "absences", count: deletionDeps.absences },
                { kind: "licenseChecks", count: deletionDeps.licenseChecks },
                { kind: "timeEntries", count: deletionDeps.timeEntries },
              ]}
              canArchive={false}
              canDelete
              deletable={employeeDeletable(deletionDeps)}
              remove={deleteEmployee}
              deleteLabel={t("employees.delete")}
              confirmDelete={t("employees.confirmDelete", { name: employeeName(e) })}
              blockedHint={t("employees.deleteBlockedHint")}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
