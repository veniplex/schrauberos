"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { setFeatureOverride } from "@/modules/features";
import { audit } from "@/server/audit";

/** Schaltet ein Modul ("office") oder eine Funktion ("office.fleet") ein/aus. Daten bleiben immer erhalten. */
export async function setEnabled(formData: FormData) {
  const session = await requirePermission("modules.manage");
  const key = String(formData.get("key") ?? "");
  const enabled = formData.get("enabled") === "true";
  const result = await setFeatureOverride(key, enabled, session.user.name);
  if (result !== "ok") return;
  await audit(enabled ? "module.enable" : "module.disable", { target: key });
  // Navigation, Dashboard, Rechte und Seiten hängen vom Aktivierungsstand ab
  revalidatePath("/", "layout");
}
