import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { Badge, Card, DefinitionList, EmptyState, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { currentYear } from "@/lib/dates";
import { DUE_TONE, dueState } from "@/lib/due";
import { employeeName, visibleAbsenceType, workdaysBetween, workdaysWithin } from "@/modules/office/employees/domain";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteAbsence, deleteEmployee, deleteQualification } from "@/modules/office/employees/actions";
import { QualificationForm } from "@/modules/office/employees/forms";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("employees.view"))) return {};
  const e = await db.employee.findUnique({ where: { id } });
  return { title: e ? employeeName(e) : undefined };
}

const TYPE_TONE = { vacation: "info", sick: "danger", training: "accent", other: "neutral", masked: "neutral" } as const;

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("employees.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, tp, td, date } = i18n;
  const canEdit = session.can("employees.edit");
  const sensitive = session.can("employees.sensitive");
  const year = currentYear();

  const e = await db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, username: true, active: true } },
      absences: { orderBy: { startDate: "desc" }, take: 20 },
      qualifications: { orderBy: [{ expiresAt: "asc" }, { name: "asc" }] },
    },
  });
  if (!e) notFound();

  const yearFrom = new Date(year, 0, 1);
  const yearTo = new Date(year, 11, 31);
  const vacationUsed = e.absences.filter((a) => a.type === "vacation").reduce((n, a) => n + workdaysWithin(a, yearFrom, yearTo), 0);
  const returnTo = `/employees/${e.id}`;

  return (
    <>
      <PageHeader
        title={employeeName(e)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {e.jobTitle ? <span>{e.jobTitle}</span> : null}
            <Badge>{td(`employees.departments.${e.department}`, e.department)}</Badge>
            {!e.active ? <Badge tone="warning">{t("employees.inactive")}</Badge> : null}
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

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5 xl:col-span-2">
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
                {t("employees.vacationSummary", { year, used: vacationUsed, total: e.vacationDaysPerYear, left: e.vacationDaysPerYear - vacationUsed })}
                <span className="block text-xs text-ink-muted">{t("employees.vacationNote")}</span>
              </p>
            ) : null}
            {e.absences.length === 0 ? (
              <EmptyState title={t("employees.noAbsences")} />
            ) : (
              <ul className="divide-y divide-line">
                {e.absences.map((a) => {
                  const type = visibleAbsenceType(a.type, sensitive);
                  const days = workdaysBetween(a.startDate, a.endDate);
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={TYPE_TONE[type]}>{type === "masked" ? t("employees.absent") : td(`employees.absenceTypes.${type}`, type)}</Badge>
                        <span className="tabular">
                          {date(a.startDate)}
                          {a.endDate.getTime() !== a.startDate.getTime() ? ` – ${date(a.endDate)}` : ""}
                        </span>
                        <span className="text-ink-muted">({tp("employees.workdays", days)})</span>
                        {a.note && type !== "masked" && type !== "sick" ? <span className="text-ink-muted">{a.note}</span> : null}
                      </span>
                      {canEdit && (a.type !== "sick" || sensitive) ? (
                        <form action={deleteAbsence}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
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
                          <Badge tone={state ? DUE_TONE[state] : "neutral"}>
                            {state === "expired" ? t("employees.expired") : t("employees.validUntil")} {date(q.expiresAt)}
                          </Badge>
                        ) : (
                          <span className="text-ink-muted">{t("employees.noExpiry")}</span>
                        )}
                        {canEdit ? (
                          <form action={deleteQualification}>
                            <input type="hidden" name="id" value={q.id} />
                            <ConfirmSubmitButton message={t("employees.qualificationDeleteConfirm")} aria-label={t("common.delete")}>
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

        <div className="flex flex-col gap-5">
          <Card title={t("employees.sections.person")}>
            <DefinitionList
              items={[
                { label: t("employees.fields.personnelNumber"), value: e.personnelNumber },
                { label: t("customers.fields.email"), value: e.email ? <a className="text-accent-text inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline" href={`mailto:${e.email}`}>{e.email}</a> : null },
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
                  <Link href={`/admin/users/${e.user.id}`} className="font-medium text-accent-text inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                    {e.user.name}
                  </Link>
                ) : (
                  <span className="font-medium">{e.user.name}</span>
                )}{" "}
                <span className="text-ink-muted">({e.user.username})</span>
                {!e.user.active ? <Badge tone="warning" className="ml-2">{t("users.inactive")}</Badge> : null}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">{t("employees.noUserLinked")}</p>
            )}
          </Card>

          {sensitive ? (
            <Card title={t("employees.sections.emergency")}>
              <DefinitionList
                items={[
                  { label: t("employees.fields.emergencyName"), value: e.emergencyName },
                  { label: t("employees.fields.emergencyPhone"), value: e.emergencyPhone },
                  { label: t("employees.fields.emergencyRelation"), value: e.emergencyRelation },
                ]}
              />
            </Card>
          ) : null}

          {session.can("employees.delete") ? (
            <form action={deleteEmployee}>
              <input type="hidden" name="id" value={e.id} />
              <ConfirmSubmitButton message={t("employees.confirmDelete", { name: employeeName(e) })}>{t("employees.delete")}</ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}
