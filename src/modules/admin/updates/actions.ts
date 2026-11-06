"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { requirePermission } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { runningMeta, UPDATE_TOKEN_KEY } from "./config";
import { createBackup } from "@/server/backup/core";
import { scheduleRestart } from "@/server/restart";
import { setSecret } from "@/server/settings";
import { installRelease } from "./install";
import { UpdateError } from "./manifest";
import { checkLatestRelease } from "./releases";

/** Fragt GitHub sofort nach der neuesten Version (statt den Zwischenspeicher zu verwenden). */
export async function checkForUpdates() {
  await requirePermission("updates.manage");
  await checkLatestRelease(true);
  revalidatePath("/admin/updates");
}

/** Installiert die angezeigte Version und startet die Anwendung neu (der Launcher übernimmt). */
export async function installUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("updates.manage");
  const { t } = await getI18n();
  const wanted = String(formData.get("version") ?? "");
  const from = runningMeta().version;

  try {
    // Immer frisch prüfen und nur genau die angezeigte Version installieren (nicht „irgendeine neuere“)
    const check = await checkLatestRelease(true);
    if ("error" in check) throw new UpdateError(check.error);
    if (check.release.version !== wanted) throw new UpdateError("notNewer");
    // Sicherheitsnetz: vor jedem Update ein Backup – scheitert es, wird nicht aktualisiert
    try {
      await createBackup("pre-update");
    } catch (error) {
      console.error("[updates] Backup vor dem Update fehlgeschlagen:", error);
      throw new UpdateError("backupFailed");
    }
    await installRelease(check.release);
    await audit("system.update", { target: `${from} → ${wanted}` });
    scheduleRestart();
    return { ok: true, message: t("updates.install.restarting") };
  } catch (error) {
    const code = error instanceof UpdateError ? error.code : "network";
    console.error("[updates] Installation fehlgeschlagen:", error);
    await audit("system.updateFailed", { target: `${wanted}: ${code}` });
    return { error: t(`updates.errors.${code}`) };
  }
}

/** Speichert (oder entfernt) das GitHub-Token für die Update-Prüfung; leere Eingabe lässt das vorhandene Token unverändert. */
export async function saveUpdateToken(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("settings.manage");
  const { t } = await getI18n();
  const token = String(formData.get("token") ?? "").trim();
  if (formData.get("remove") === "on") await setSecret(UPDATE_TOKEN_KEY, null);
  else if (token) await setSecret(UPDATE_TOKEN_KEY, token.slice(0, 300));
  await checkLatestRelease(true);
  revalidatePath("/admin/updates");
  return { ok: true, message: t("common.saved") };
}
