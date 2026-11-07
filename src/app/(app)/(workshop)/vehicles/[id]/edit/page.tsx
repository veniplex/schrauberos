import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plate } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { VehicleForm } from "@/modules/workshop/vehicles/forms";
import { versionOf } from "@/lib/concurrency";
import { toDateInput } from "@/lib/dates";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicles.edit") };
}

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("vehicles.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const v = await db.vehicle.findUnique({ where: { id } });
  if (!v) notFound();

  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/vehicles", label: t("nav.vehicles") }, { href: `/vehicles/${v.id}`, label: v.plate }]} help="workshop.vehicles" title={t("vehicles.edit")} description={<Plate>{v.plate}</Plate>} />
      <div className="max-w-2xl">
        <VehicleForm
          cancelHref={`/vehicles/${v.id}`}
          initial={{
            id: v.id,
            version: versionOf(v),
            customer: null,
            plate: v.plate,
            make: v.make ?? "",
            model: v.model ?? "",
            vin: v.vin ?? "",
            year: v.year != null ? String(v.year) : "",
            mileage: v.mileageKm != null ? String(v.mileageKm) : "",
            fuel: v.fuel ?? "",
            hsn: v.hsn ?? "",
            tsn: v.tsn ?? "",
            firstRegistration: v.firstRegistration ? toDateInput(v.firstRegistration) : "",
            inspectionDue: v.inspectionDue ?? "",
            extraKind: v.extraInspectionKind ?? "",
            extraDue: v.extraInspectionDue ? toDateInput(v.extraInspectionDue) : "",
            notes: v.notes ?? "",
          }}
        />
      </div>
    </>
  );
}
