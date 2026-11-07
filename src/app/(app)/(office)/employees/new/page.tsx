import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { linkableAccounts } from "@/modules/office/employees/queries";
import { EmployeeForm } from "@/modules/office/employees/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("employees.new") };
}

export default async function NewEmployeePage() {
  const session = await requirePermission("employees.edit");
  const [{ t }, users] = await Promise.all([
    getI18n(),
    // nur aktive Konten ohne bereits verknüpften Mitarbeiter
    linkableAccounts(session),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/employees", label: t("nav.employees") }} help="office.employees" title={t("employees.new")} />
      <EmployeeForm
        cancelHref="/employees"
        users={users}
        canSensitive={session.can("employees.sensitive")}
        initial={{
          firstName: "", lastName: "", personnelNumber: "", jobTitle: "", department: "other", email: "", phone: "", mobile: "",
          hireDate: "", leaveDate: "", active: true, vacationDaysPerYear: "30", workWeekdays: [1, 2, 3, 4, 5], vacationCarryYear: "", vacationCarryDays: "", notes: "", emergencyName: "", emergencyPhone: "",
          emergencyRelation: "", userId: "",
        }}
      />
    </>
  );
}
