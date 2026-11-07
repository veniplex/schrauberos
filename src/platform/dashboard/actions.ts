"use server";

import { z } from "zod";
import { defineAction, defineOperation } from "@/server/operations";
import { SETUP_CHECKLIST_HIDDEN } from "@/lib/dashboard";
import { setSetting } from "@/server/settings";

/**
 * Einrichtungs-Checkliste ausblenden („abschließen“) oder wieder einblenden. Gilt für die ganze Werkstatt und gehört zur Verwaltung (`settings.manage`, nur Administratoren):
 * Plattform, daher nie eine API-Ressource. Die Punkte selbst werden nie abgehakt – sie rechnen sich aus dem Datenstand; ausgeblendet wird nur die Karte.
 */
const setSetupChecklistOperation = defineOperation({
  name: "dashboard.setSetupChecklist",
  permission: "settings.manage",
  input: z.object({ hidden: z.enum(["true", "false"]) }),
  audit: (input) => (input.hidden === "true" ? "setup.checklistHide" : "setup.checklistShow"),
  run: async ({ input, tx }) => {
    await setSetting(SETUP_CHECKLIST_HIDDEN, input.hidden === "true" ? "true" : null, tx);
    return { hidden: input.hidden === "true" };
  },
});

export const setSetupChecklistHidden = defineAction(setSetupChecklistOperation, {
  form: (fd) => ({ hidden: String(fd.get("hidden") ?? "") }),
  revalidate: [["/", "layout"]],
});
