import type { Prisma } from "@/generated/prisma/client";

/** Stati, in denen ein Termin noch bevorsteht oder läuft: Nur diese ziehen bei einem Halterwechsel nach (erledigte, abgesagte und nicht erschienene bleiben, wie sie waren). */
export const OPEN_APPOINTMENT_STATUSES = ["scheduled", "confirmed", "in_progress"] as const;

/**
 * Halterwechsel (P4b-1): Die **offenen Termine des Fahrzeugs, die noch nicht zu Ende sind**, bekommen den neuen Halter (null = Fahrzeug ohne Halter). Läuft in der Transaktion der Operation
 * `vehicles.transfer`; `since` ist die Schwelle (der spätere Zeitpunkt von „jetzt“ und Beginn des Wechseltags): Termine, die schon vorbei sind, behalten den damaligen Kunden. Liefert die Zahl
 * der tatsächlich geänderten Termine (Termine, die schon den neuen Halter haben, zählen nicht).
 */
export async function followVehicleOwner(tx: Prisma.TransactionClient, vehicleId: string, newCustomerId: string | null, since: Date): Promise<number> {
  const result = await tx.appointment.updateMany({
    where: {
      vehicleId,
      status: { in: [...OPEN_APPOINTMENT_STATUSES] },
      endsAt: { gt: since },
      OR: newCustomerId === null ? [{ customerId: { not: null } }] : [{ customerId: null }, { customerId: { not: newCustomerId } }],
    },
    data: { customerId: newCustomerId },
  });
  return result.count;
}
