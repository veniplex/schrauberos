import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plate } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { toDateInput } from "@/lib/dates";
import { employeeName } from "@/modules/office/employees/public";
import { centsToInput } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { FleetForm } from "@/modules/office/fleet/forms";
import { versionOf } from "@/lib/concurrency";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("fleet.edit") };
}

export default async function EditFleetVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("fleet.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const [v, employees] = await Promise.all([
    db.fleetVehicle.findUnique({ where: { id } }),
    db.employee.findMany({ where: { active: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
  ]);
  if (!v) notFound();
  const d = (x: Date | null) => (x ? toDateInput(x) : "");

  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/fleet", label: t("nav.fleet") }, { href: `/fleet/${v.id}`, label: v.plate }]} help="office.fleet" title={t("fleet.edit")} description={<Plate>{v.plate}</Plate>} />
      <FleetForm
        cancelHref={`/fleet/${v.id}`}
        drivers={employees.map((e) => ({ id: e.id, name: employeeName(e) }))}
        initial={{
          id: v.id,
          version: versionOf(v),
          plate: v.plate,
          make: v.make ?? "",
          model: v.model ?? "",
          vin: v.vin ?? "",
          year: v.year != null ? String(v.year) : "",
          fuelType: v.fuelType ?? "",
          color: v.color ?? "",
          status: v.status,
          driverId: v.driverId ?? "",
          location: v.location ?? "",
          huDue: d(v.huDue),
          serviceDue: d(v.serviceDue),
          serviceDueKm: v.serviceDueKm != null ? String(v.serviceDueKm) : "",
          insuranceCompany: v.insuranceCompany ?? "",
          insurancePolicy: v.insurancePolicy ?? "",
          insuranceUntil: d(v.insuranceUntil),
          leasingProvider: v.leasingProvider ?? "",
          leasingUntil: d(v.leasingUntil),
          leasingRate: centsToInput(v.leasingRateCents),
          fuelCardNo: v.fuelCardNo ?? "",
          notes: v.notes ?? "",
        }}
      />
    </>
  );
}
