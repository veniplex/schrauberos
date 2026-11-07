import { unrestrictedDocument } from "@/modules/workshop/customers/public";
import { db } from "@/server/db";
import type { WebhookRestrictionDef } from "@/server/webhooks/restriction-types";

/** Ereignisse `billing.*`: eingeschränkt, wenn der Kunde des Belegs **oder der Halter seines Fahrzeugs** eingeschränkt verarbeitet wird – dieselbe Bedingung wie `/billing-documents` der API. */
export const webhookRestrictions: WebhookRestrictionDef[] = [
  { resource: "billing-documents", restricted: async (id) => (await db.invoice.count({ where: { id, NOT: unrestrictedDocument } })) > 0 },
];
