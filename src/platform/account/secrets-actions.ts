"use server";

import { z } from "zod";
import { defineAction, defineOperation, fail } from "@/server/operations";
import { acknowledgeResetNotice } from "@/server/secret-reset";

/** Hinweis „nach der Wiederherstellung wurden Geheimnisse zurückgesetzt“ als gesehen markieren – nur Administratoren sehen ihn. */
const acknowledgeSecretsResetOperation = defineOperation({
  name: "account.acknowledgeSecretsReset",
  permission: "authenticated",
  input: z.object({}),
  audit: false,
  auditReason: "Das Ausblenden des Hinweises ändert keine Daten; das Zurücksetzen der Geheimnisse selbst steht im Audit-Log",
  run: async ({ principal, tx }) => {
    if (!principal.user.isAdmin) fail("forbidden");
    await acknowledgeResetNotice(tx);
    return {};
  },
});

export const acknowledgeSecretsReset = defineAction(acknowledgeSecretsResetOperation, { revalidate: [["/", "layout"]] });
