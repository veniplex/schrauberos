import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/lib/domain/vehicles";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteVehicle } from "@/modules/customers/actions";
import { VehicleForm } from "@/modules/customers/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicles.edit") };
}

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string; vehicleId: string }> }) {
  const session = await requirePermission("customers.edit");
  const [{ t }, { id, vehicleId }] = await Promise.all([getI18n(), params]);
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, customerId: id }, include: { customer: true } });
  if (!vehicle) notFound();

  return (
    <>
      <PageHeader title={t("vehicles.edit")} description={customerDisplayName(vehicle.customer)} />
      <div className="flex max-w-2xl flex-col gap-4">
        <VehicleForm
          cancelHref={`/customers/${id}`}
          initial={{
            id: vehicle.id,
            customerId: id,
            plate: vehicle.plate,
            make: vehicle.make ?? "",
            model: vehicle.model ?? "",
            vin: vehicle.vin ?? "",
            year: vehicle.year != null ? String(vehicle.year) : "",
            notes: vehicle.notes ?? "",
          }}
        />
        {session.can("customers.delete") ? (
          <form action={deleteVehicle}>
            <input type="hidden" name="id" value={vehicle.id} />
            <input type="hidden" name="customerId" value={id} />
            <ConfirmSubmitButton message={t("vehicles.confirmDelete")}>{t("vehicles.delete")}</ConfirmSubmitButton>
          </form>
        ) : null}
      </div>
    </>
  );
}
