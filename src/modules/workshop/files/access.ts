import type { Prisma } from "@/generated/prisma/client";
import { normalizePlate } from "@/lib/plate";
import { unrestrictedCustomerWhere } from "@/modules/workshop/customers/public";
import { orderRef } from "@/modules/workshop/orders/public";
import { vehicleRef } from "@/modules/workshop/vehicles/public";
import type { AppSession } from "@/server/auth/session";
import { fail, type Tx } from "@/server/operations";
import type { FileOwnerType } from "./constants";

/**
 * Wer welche Dateien sehen und bearbeiten darf – an **einer** Stelle für Seiten, Auslieferung, API und Operationen:
 *  - Dateien eines **Fahrzeugs** nur mit `files.view` **und** `vehicles.view` (Funktion Fahrzeuge aktiv), Dateien eines **Auftrags** nur mit `files.view` **und** `orders.view` (Funktion Aufträge aktiv) –
 *    wer das Fahrzeug oder den Auftrag nicht sehen darf, sieht auch seine Dateien nicht;
 *  - Fahrzeuge und Aufträge von Kunden mit **eingeschränkter Verarbeitung** (Art. 18 DSGVO) gibt es nicht: ihre Dateien sind unsichtbar (404) und es lassen sich keine neuen anlegen;
 *  - entfernte (archivierte) Dateien sind unsichtbar.
 */

type Actor = Pick<AppSession, "can" | "features">;

export const canSeeVehicles = (actor: Actor): boolean => actor.features.has("workshop.vehicles") && actor.can("vehicles.view");
export const canSeeOrders = (actor: Actor): boolean => actor.features.has("workshop.orders") && actor.can("orders.view");

const UNRESTRICTED = { OR: [{ customerId: null }, { customer: { is: unrestrictedCustomerWhere } }] };
/** Ein Auftrag zählt als eingeschränkt, wenn sein Kunde **oder der Halter seines Fahrzeugs** eingeschränkt verarbeitet wird (wie bei den Checklisten: die strengere Auslegung). */
const ORDER_UNRESTRICTED = { AND: [UNRESTRICTED, { vehicle: { is: UNRESTRICTED } }] };

/** Bedingung für alle Dateien, die der Betrachter sehen darf; `null`, wenn er keine sehen darf. */
export function visibleFilesWhere(actor: Actor): Prisma.FileAttachmentWhereInput | null {
  if (!actor.can("files.view")) return null;
  const alternatives: Prisma.FileAttachmentWhereInput[] = [];
  if (canSeeVehicles(actor)) alternatives.push({ vehicleId: { not: null }, vehicle: { is: UNRESTRICTED } });
  if (canSeeOrders(actor)) alternatives.push({ orderId: { not: null }, order: { is: ORDER_UNRESTRICTED } });
  return alternatives.length > 0 ? { archivedAt: null, OR: alternatives } : null;
}

export type OwnerAccess = { type: FileOwnerType; id: string; label: string; dir: string };

/**
 * Prüft den Eigentümer einer neuen Datei (Fahrzeug oder Auftrag) für die handelnde Person und liefert Bezeichnung und Ablageordner. Fehlendes Recht oder fehlende Funktion: `forbidden`;
 * unbekannt oder eingeschränkter Kunde: `notFound`; archiviertes Fahrzeug und nicht offener Auftrag: Fehler mit Meldung. `client` darf die Transaktion der Operation sein.
 */
export async function ownerAccess(principal: Actor, type: FileOwnerType, id: string, client?: Tx): Promise<OwnerAccess> {
  if (type === "vehicle") {
    if (!canSeeVehicles(principal)) fail("forbidden");
    const ref = await vehicleRef(id, client);
    if (!ref || ref.restricted) fail("notFound");
    if (ref.archived) fail("invalid", "files.errors.vehicleArchived");
    return { type, id: ref.id, label: ref.plate, dir: `fahrzeuge/${normalizePlate(ref.plate) || "ohne-kennzeichen"}` };
  }
  if (!canSeeOrders(principal)) fail("forbidden");
  const ref = await orderRef(id, client);
  if (!ref || ref.restricted) fail("notFound");
  if (!ref.open) fail("invalid", "files.errors.orderClosed");
  const vehicle = await vehicleRef(ref.vehicleId, client);
  if (!vehicle || vehicle.restricted) fail("notFound");
  return { type, id: ref.id, label: ref.number, dir: `auftraege/${ref.number}` };
}
