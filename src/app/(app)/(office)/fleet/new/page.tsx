import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { employeeName } from "@/modules/office/employees/public";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { FleetForm } from "@/modules/office/fleet/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("fleet.new") };
}

export default async function NewFleetVehiclePage() {
  await requirePermission("fleet.edit");
  const [{ t }, employees] = await Promise.all([getI18n(), db.employee.findMany({ where: { active: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] })]);
  return (
    <>
      <PageHeader title={t("fleet.new")} />
      <FleetForm
        cancelHref="/fleet"
        drivers={employees.map((e) => ({ id: e.id, name: employeeName(e) }))}
        initial={{
          plate: "", make: "", model: "", vin: "", year: "", fuelType: "", color: "", status: "active", driverId: "", location: "",
          huDue: "", serviceDue: "", serviceDueKm: "", insuranceCompany: "", insurancePolicy: "", insuranceUntil: "",
          leasingProvider: "", leasingUntil: "", leasingRate: "", fuelCardNo: "", notes: "",
        }}
      />
    </>
  );
}
