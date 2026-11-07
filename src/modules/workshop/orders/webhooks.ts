import { unrestrictedOrder } from "@/modules/workshop/customers/public";
import { db } from "@/server/db";
import type { WebhookRestrictionDef } from "@/server/webhooks/restriction-types";

/** Ereignisse `order.*`: eingeschränkt, wenn der Kunde des Auftrags **oder der Halter seines Fahrzeugs** eingeschränkt verarbeitet wird – dieselbe Bedingung wie `/orders` der API. */
export const webhookRestrictions: WebhookRestrictionDef[] = [
  { resource: "orders", restricted: async (id) => (await db.order.count({ where: { id, NOT: unrestrictedOrder } })) > 0 },
];
