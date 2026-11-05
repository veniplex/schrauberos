import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/lib/domain/vehicles";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { VehicleForm } from "@/modules/customers/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicles.new") };
}

export default async function NewVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  return (
    <>
      <PageHeader title={t("vehicles.new")} description={customerDisplayName(customer)} />
      <div className="max-w-2xl">
        <VehicleForm
          cancelHref={`/customers/${customer.id}`}
          initial={{ customerId: customer.id, plate: "", make: "", model: "", vin: "", year: "", notes: "" }}
        />
      </div>
    </>
  );
}
