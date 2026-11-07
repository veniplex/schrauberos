import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { toDateInput } from "@/lib/dates";
import { employeeName } from "@/modules/office/employees/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { EmployeeForm } from "@/modules/office/employees/forms";
import { versionOf } from "@/lib/concurrency";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("employees.edit") };
}

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("employees.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const e = await db.employee.findUnique({ where: { id } });
  if (!e) notFound();
  const users = await db.user.findMany({
    where: { active: true, OR: [{ employee: { is: null } }, { id: e.userId ?? "" }] },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });
  const canSensitive = session.can("employees.sensitive");

  return (
    <>
      <PageHeader title={t("employees.edit")} description={employeeName(e)} />
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
          notes: e.notes ?? "",
          emergencyName: canSensitive ? (e.emergencyName ?? "") : "",
          emergencyPhone: canSensitive ? (e.emergencyPhone ?? "") : "",
          emergencyRelation: canSensitive ? (e.emergencyRelation ?? "") : "",
          userId: e.userId ?? "",
        }}
      />
    </>
  );
}
