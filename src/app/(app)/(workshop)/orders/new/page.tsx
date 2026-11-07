import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { customerNameSelect } from "@/modules/workshop/customers/public";
import { OrderForm } from "@/modules/workshop/orders/order-form";
import { toVehicleOption } from "@/modules/workshop/vehicles/public";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("orders.new") };
}

/**
 * Neuer Auftrag. Vorbelegt wird aus dem Fahrzeug (`?vehicle=`) oder aus einem Termin (`?appointment=`: Fahrzeug und Anliegen kommen aus dem Termin). Nur nicht archivierte Fahrzeuge
 * lassen sich wählen (die Auswahl `/api/vehicles/search` blendet Archiviertes aus).
 */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ vehicle?: string; appointment?: string }> }) {
  const session = await requirePermission("orders.create");
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const appointment =
    sp.appointment && session.can("appointments.view")
      ? await db.appointment.findUnique({ where: { id: sp.appointment }, select: { id: true, title: true, notes: true, vehicleId: true, status: true } })
      : null;
  const usable = appointment && appointment.status !== "cancelled" && appointment.status !== "no_show" ? appointment : null;
  const vehicleId = usable?.vehicleId ?? sp.vehicle;
  const vehicle = vehicleId ? await db.vehicle.findFirst({ where: { id: vehicleId, archivedAt: null }, select: { id: true, plate: true, make: true, model: true, customer: { select: customerNameSelect } } }) : null;

  return (
    <>
      <PageHeader back={{ href: "/orders", label: t("nav.orders") }} help="workshop.orders" title={t("orders.new")} description={t("orders.newDescription")} />
      <OrderForm
        initial={{
          vehicle: vehicle ? toVehicleOption(vehicle) : null,
          appointmentId: usable?.id,
          appointmentLabel: usable?.title,
          request: usable ? [usable.title, usable.notes].filter(Boolean).join("\n") : "",
          mileageKm: "",
        }}
        cancelHref="/orders"
        canCreateVehicle={session.can("vehicles.edit")}
      />
    </>
  );
}
