import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Plate } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { VehicleForm } from "@/modules/vehicles/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicles.edit") };
}

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const v = await db.vehicle.findUnique({ where: { id } });
  if (!v) notFound();

  return (
    <>
      <PageHeader title={t("vehicles.edit")} description={<Plate>{v.plate}</Plate>} />
      <div className="max-w-2xl">
        <VehicleForm
          cancelHref={`/vehicles/${v.id}`}
          initial={{
            id: v.id,
            customer: null,
            plate: v.plate,
            make: v.make ?? "",
            model: v.model ?? "",
            vin: v.vin ?? "",
            year: v.year != null ? String(v.year) : "",
            notes: v.notes ?? "",
          }}
        />
      </div>
    </>
  );
}
