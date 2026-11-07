import { FilePlus2, ClipboardList } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import type { SectionDef } from "@/modules/types";
import { orderForAppointment } from "./queries";

/**
 * Beitrag zur Terminansicht: „Auftrag aus Termin“. Die Terminfunktion kennt Aufträge nicht – sie fragt nur ihren Erweiterungspunkt (`appointments/detail`). Gibt es zum Termin schon einen
 * (nicht stornierten) Auftrag, führt der Knopf dorthin, sonst legt er einen vorbelegten an (Fahrzeug, Kunde und Anliegen kommen aus dem Termin).
 */
async function OrderFromAppointment({ entityId, session }: { entityId: string; session: { can(permission: string): boolean } }) {
  const { t } = await getI18n();
  const existing = session.can("orders.view") ? await orderForAppointment(entityId) : null;
  if (existing) {
    return (
      <LinkButton href={`/orders/${existing.id}`} variant="secondary">
        <ClipboardList className="size-4" aria-hidden /> {t("orders.fromAppointment.open", { number: existing.number })}
      </LinkButton>
    );
  }
  if (!session.can("orders.create")) return null;
  return (
    <LinkButton href={`/orders/new?appointment=${encodeURIComponent(entityId)}`} variant="secondary">
      <FilePlus2 className="size-4" aria-hidden /> {t("orders.fromAppointment.create")}
    </LinkButton>
  );
}

export const sections: SectionDef[] = [
  { id: "orders-from-appointment", feature: "workshop.orders", host: "appointments/detail", permission: "orders.view", order: 10, Component: OrderFromAppointment },
];
