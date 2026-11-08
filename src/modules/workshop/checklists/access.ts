import type { Prisma } from "@/generated/prisma/client";
import { unrestrictedByCustomer, unrestrictedByVehicle } from "@/modules/workshop/customers/public";
import { canSeeOrders, orderOwner } from "@/modules/workshop/orders/public";
import { canSeeVehicles, vehicleOwner } from "@/modules/workshop/vehicles/public";
import type { AppSession } from "@/server/auth/session";
import { fail, type Tx } from "@/server/operations";

/**
 * Wer welche Checklisten sehen und ausfüllen darf – an **einer** Stelle für Seiten, Auslieferung der Unterschrift, API und Operationen:
 *  - eine Checkliste **am Auftrag** sieht, wer `checklists.view` **und** `orders.view` hat; eine Checkliste nur **am Fahrzeug** (ohne Auftrag), wer `checklists.view` **und** `vehicles.view` hat;
 *  - Fahrzeuge und Aufträge von Kunden mit **eingeschränkter Verarbeitung** (Art. 18 DSGVO) gibt es nicht: ihre Checklisten sind unsichtbar (404), neue lassen sich nicht anlegen.
 */

type Actor = Pick<AppSession, "can" | "features">;

/** Checkliste, deren Fahrzeughalter und (falls am Auftrag) Auftragskunde nicht eingeschränkt sind – unabhängig vom Betrachter (API-Sichtbarkeit und Webhooks teilen sie). */
export const unrestrictedChecklistWhere: Prisma.ChecklistWhereInput = { AND: [unrestrictedByVehicle, { OR: [{ orderId: null }, { order: { is: unrestrictedByCustomer } }] }] };

/** Bedingung für alle Checklisten, die der Betrachter sehen darf; `null`, wenn er keine sehen darf. */
export function visibleChecklistsWhere(actor: Actor): Prisma.ChecklistWhereInput | null {
  if (!actor.can("checklists.view")) return null;
  const alternatives: Prisma.ChecklistWhereInput[] = [];
  if (canSeeVehicles(actor)) alternatives.push({ orderId: null, ...unrestrictedByVehicle });
  if (canSeeOrders(actor)) alternatives.push({ orderId: { not: null }, order: { is: unrestrictedByCustomer }, ...unrestrictedByVehicle });
  return alternatives.length > 0 ? { OR: alternatives } : null;
}

export type Owner = { vehicleId: string; orderId: string | null; plate: string; label: string };

/**
 * Prüft Fahrzeug bzw. Auftrag für eine neue Checkliste und liefert Fahrzeug, Auftrag und Bezeichnung. Mit Auftrag zählt der Auftrag (das Fahrzeug ergibt sich aus ihm): Recht `orders.view`, offen,
 * kein eingeschränkter Kunde. Ohne Auftrag: Recht `vehicles.view`, nicht archiviert, kein eingeschränkter Kunde. `client` darf die Transaktion der Operation sein.
 */
export async function ownerAccess(principal: Actor, target: { vehicleId?: string; orderId?: string }, client?: Tx): Promise<Owner> {
  if (target.orderId) {
    const order = await orderOwner(principal, target.orderId, "checklists.errors.orderClosed", client);
    return { vehicleId: order.vehicleId, orderId: order.id, plate: order.plate, label: `${order.number} · ${order.plate}` };
  }
  if (!target.vehicleId) fail("invalid", "checklists.errors.ownerRequired");
  const vehicle = await vehicleOwner(principal, target.vehicleId, "checklists.errors.vehicleArchived", client);
  return { vehicleId: vehicle.id, orderId: null, plate: vehicle.plate, label: vehicle.plate };
}
