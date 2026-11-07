import { db } from "@/server/db";
import type { WebhookRestrictionDef } from "@/server/webhooks/restriction-types";
import { unrestrictedChecklistWhere } from "./access";

/** Ereignisse `checklist.*`: eingeschränkt, wenn Fahrzeughalter oder Kunde des Auftrags eingeschränkt verarbeitet werden (`unrestrictedChecklistWhere`, dieselbe Auslegung wie in der API). */
export const webhookRestrictions: WebhookRestrictionDef[] = [
  { resource: "checklists", restricted: async (id) => (await db.checklist.count({ where: { id, NOT: unrestrictedChecklistWhere } })) > 0 },
];
