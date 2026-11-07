import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { toDateInput } from "@/lib/dates";
import { employeeName } from "@/modules/office/employees/domain";
import { getEmployeeForEdit, linkableAccounts } from "@/modules/office/employees/queries";
import { workWeekdayList } from "@/modules/office/employees/work-pattern";
import { requirePermission } from "@/server/auth/session";
import { EmployeeForm } from "@/modules/office/employees/forms";
import { versionOf } from "@/lib/concurrency";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("employees.edit") };
}

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("employees.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const e = await getEmployeeForEdit(session, id);
  if (!e) notFound();
  const users = await linkableAccounts(session, e.userId);
  // Der Notfallkontakt ist nur mit `employees.sensitive` geladen (`e.emergency`), sonst null
  const canSensitive = session.can("employees.sensitive");

  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/employees", label: t("nav.employees") }, { href: `/employees/${e.id}`, label: employeeName(e) }]} help="office.employees" title={t("employees.edit")} description={employeeName(e)} />
      <EmployeeForm
        cancelHref={`/employees/${e.id}`}
        users={users}
        canSensitive={canSensitive}
        initial={{
          id: e.id,
          version: versionOf(e),
          firstName: e.firstName,
          lastName: e.lastName,
          personnelNumber: e.personnelNumber ?? "",
          jobTitle: e.jobTitle ?? "",
          department: e.department,
          email: e.email ?? "",
          phone: e.phone ?? "",
          mobile: e.mobile ?? "",
          hireDate: e.hireDate ? toDateInput(e.hireDate) : "",
          leaveDate: e.leaveDate ? toDateInput(e.leaveDate) : "",
          active: e.active,
          vacationDaysPerYear: e.vacationDaysPerYear != null ? String(e.vacationDaysPerYear) : "",
          workWeekdays: workWeekdayList(e.workWeekdays),
          vacationCarryYear: e.vacationCarryYear != null ? String(e.vacationCarryYear) : "",
          vacationCarryDays: e.vacationCarryDays != null ? String(e.vacationCarryDays).replace(".", ",") : "",
          notes: e.notes ?? "",
          emergencyName: e.emergency?.name ?? "",
          emergencyPhone: e.emergency?.phone ?? "",
          emergencyRelation: e.emergency?.relation ?? "",
          userId: e.userId ?? "",
        }}
      />
    </>
  );
}
