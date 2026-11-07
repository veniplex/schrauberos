import { db } from "@/server/db";
import type { WebhookRestrictionDef } from "@/server/webhooks/restriction-types";
import { unrestrictedFileWhere } from "./access";

/** Ereignisse `file.*`: eingeschränkt, wenn Fahrzeughalter bzw. Kunde und Fahrzeughalter des Auftrags eingeschränkt verarbeitet werden (`unrestrictedFileWhere`, dieselbe Auslegung wie in der API). */
export const webhookRestrictions: WebhookRestrictionDef[] = [
  { resource: "files", restricted: async (id) => (await db.fileAttachment.count({ where: { id, NOT: unrestrictedFileWhere } })) > 0 },
];
