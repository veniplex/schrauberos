"use server";

import { z } from "zod";
import { setFeatureOverride } from "@/modules/features";
import { defineAction, defineOperation, fail } from "@/server/operations";

/** Schaltet ein Modul ("office") oder eine Funktion ("office.fleet") ein/aus. Daten bleiben immer erhalten. */
const setEnabledOperation = defineOperation({
  name: "admin.modules.setEnabled",
  permission: "modules.manage",
  input: z.object({ key: z.string().min(1).max(60), enabled: z.boolean() }),
  audit: (input) => (input.enabled ? "module.enable" : "module.disable"),
  run: async ({ input, principal, tx, audit }) => {
    const result = await setFeatureOverride(input.key, input.enabled, principal.user.name, tx);
    if (result === "unknown") fail("notFound", "modules.errors.unknown");
    if (result === "required") fail("forbidden", "modules.errors.required");
    audit({ target: input.key });
    return { key: input.key };
  },
});

export const setEnabled = defineAction(setEnabledOperation, {
  form: (fd) => ({ key: String(fd.get("key") ?? ""), enabled: fd.get("enabled") === "true" }),
  // Navigation, Dashboard, Rechte und Seiten hängen vom Aktivierungsstand ab
  revalidate: [["/", "layout"]],
  message: "common.saved",
});
