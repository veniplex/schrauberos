import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { EmployeeForm } from "@/modules/employees/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("employees.new") };
}

export default async function NewEmployeePage() {
  const session = await requirePermission("employees.edit");
  const [{ t }, users] = await Promise.all([
    getI18n(),
    // nur aktive Konten ohne bereits verknüpften Mitarbeiter
    db.user.findMany({ where: { active: true, employee: { is: null } }, select: { id: true, name: true, username: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title={t("employees.new")} />
      <EmployeeForm
        cancelHref="/employees"
        users={users}
        canSensitive={session.can("employees.sensitive")}
        initial={{
          firstName: "", lastName: "", personnelNumber: "", jobTitle: "", department: "other", email: "", phone: "", mobile: "",
          hireDate: "", leaveDate: "", active: true, vacationDaysPerYear: "30", notes: "", emergencyName: "", emergencyPhone: "",
          emergencyRelation: "", userId: "",
        }}
      />
    </>
  );
}
