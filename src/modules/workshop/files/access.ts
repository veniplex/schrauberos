import type { Prisma } from "@/generated/prisma/client";
import { normalizePlate } from "@/lib/plate";
import { unrestrictedByCustomer, unrestrictedOrder } from "@/modules/workshop/customers/public";
import { canSeeOrders, orderOwner } from "@/modules/workshop/orders/public";
import { canSeeVehicles, vehicleOwner } from "@/modules/workshop/vehicles/public";
import type { AppSession } from "@/server/auth/session";
import type { Tx } from "@/server/operations";
import type { FileOwnerType } from "./constants";

/**
 * Wer welche Dateien sehen und bearbeiten darf – an **einer** Stelle für Seiten, Auslieferung, API und Operationen:
 *  - Dateien eines **Fahrzeugs** nur mit `files.view` **und** `vehicles.view` (Funktion Fahrzeuge aktiv), Dateien eines **Auftrags** nur mit `files.view` **und** `orders.view` (Funktion Aufträge aktiv) –
 *    wer das Fahrzeug oder den Auftrag nicht sehen darf, sieht auch seine Dateien nicht;
 *  - Fahrzeuge und Aufträge von Kunden mit **eingeschränkter Verarbeitung** (Art. 18 DSGVO) gibt es nicht: ihre Dateien sind unsichtbar (404) und es lassen sich keine neuen anlegen;
 *  - entfernte (archivierte) Dateien sind unsichtbar.
 */

type Actor = Pick<AppSession, "can" | "features">;

const UNRESTRICTED = unrestrictedByCustomer;
/** Ein Auftrag zählt als eingeschränkt, wenn sein Kunde **oder der Halter seines Fahrzeugs** eingeschränkt verarbeitet wird (`customers/public.ts`: die eine Auslegung für alle Funktionen). */
const ORDER_UNRESTRICTED = unrestrictedOrder;

/** Datei an einem Fahrzeug (Halter nicht eingeschränkt) oder an einem Auftrag (Kunde und Fahrzeughalter nicht eingeschränkt) – unabhängig vom Betrachter (API-Sichtbarkeit und Webhooks teilen sie). */
export const unrestrictedFileWhere: Prisma.FileAttachmentWhereInput = {
  OR: [
    { vehicleId: { not: null }, vehicle: { is: UNRESTRICTED } },
    { orderId: { not: null }, order: { is: ORDER_UNRESTRICTED } },
  ],
};

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
  // Recht, Funktion, Art. 18, Archiv und offener Auftrag prüfen `vehicleOwner`/`orderOwner` – eine Regel für Dateien und Checklisten (Z6-3 M-5)
  if (type === "vehicle") {
    const ref = await vehicleOwner(principal, id, "files.errors.vehicleArchived", client);
    return { type, id: ref.id, label: ref.plate, dir: `fahrzeuge/${normalizePlate(ref.plate) || "ohne-kennzeichen"}` };
  }
  const ref = await orderOwner(principal, id, "files.errors.orderClosed", client);
  return { type, id: ref.id, label: ref.number, dir: `auftraege/${ref.number}` };
}
