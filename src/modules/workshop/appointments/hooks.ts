import type { OperationHookDef } from "@/server/operations/hooks";
import type { OrderChange } from "@/modules/workshop/orders/public";
import { appointmentStatusForOrder } from "./order-sync";

/** Anonymisierung eines Kunden (`customers.anonymize`, P4b-5): Seine Termine verlieren den Kundenbezug, die Notizen (Freitext) entfallen und der Titel wird neutral. Zeit, Art, Arbeitsplatz und Fahrzeug bleiben. */
const anonymize: OperationHookDef = {
  operation: "customers.anonymize",
  feature: "workshop.appointments",
  run: async ({ tx, input }) => {
    const { id } = input as { id: string };
    await tx.appointment.updateMany({ where: { customerId: id }, data: { customerId: null, notes: null, title: "(anonymisiert)" } });
  },
};

/**
 * Der Terminstatus folgt dem Auftrag (F2): Der Hook läuft **in der Transaktion der Auftragsoperation** – gelingt die eine nicht, gilt die andere auch nicht. Die Aufträge kennen diesen Hook nicht;
 * er liest nur das Ergebnis der Operation (`OrderChange`: Status und Termin). Das Audit steht beim Auftrag (die Terminänderung ist eine Folge davon).
 */
const followOrder = (operation: "orders.setStatus" | "orders.close" | "orders.reopen"): OperationHookDef => ({
  operation,
  feature: "workshop.appointments",
  run: async ({ tx, result }) => {
    const order = result as OrderChange;
    if (!order.appointmentId) return;
    const appointment = await tx.appointment.findUnique({ where: { id: order.appointmentId }, select: { status: true } });
    if (!appointment) return;
    const next = appointmentStatusForOrder(operation, order.status, appointment.status);
    if (next) await tx.appointment.update({ where: { id: order.appointmentId }, data: { status: next } });
  },
});

export const hooks: OperationHookDef[] = [anonymize, followOrder("orders.setStatus"), followOrder("orders.close"), followOrder("orders.reopen")];
