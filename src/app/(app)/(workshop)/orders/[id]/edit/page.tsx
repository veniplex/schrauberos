import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { versionOf } from "@/lib/concurrency";
import { OrderForm } from "@/modules/workshop/orders/order-form";
import { getOrderDetail } from "@/modules/workshop/orders/queries";
import { toVehicleOption } from "@/modules/workshop/vehicles/public";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  if (!(await sessionIfAllowed("orders.edit"))) return {};
  const order = await db.order.findUnique({ where: { id }, select: { number: true } });
  return { title: order ? `${order.number} · ${t("orders.edit")}` : t("orders.edit") };
}

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders.edit");
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  const order = await getOrderDetail(session, id);
  // Abgeschlossene und stornierte Aufträge ändert man nicht (abgeschlossene nur über „Wieder öffnen“)
  if (!order || !order.open) notFound();

  return (
    <>
      <PageHeader back={{ href: `/orders/${order.id}`, label: order.number }} help="workshop.orders" title={t("orders.edit")} description={order.number} />
      <OrderForm
        initial={{
          id: order.id,
          version: versionOf(order),
          vehicle: toVehicleOption({ id: order.vehicle.id, plate: order.vehicle.plate, make: order.vehicle.make, model: order.vehicle.model, customer: order.customer }),
          request: order.request ?? "",
          mileageKm: order.mileageKm == null ? "" : String(order.mileageKm),
        }}
        cancelHref={`/orders/${order.id}`}
      />
    </>
  );
}
