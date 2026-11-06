"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { requirePermission } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { createBackup, deleteBackup, isBackupName } from "@/server/backup/core";
import { RestoreError, stageRestore } from "@/server/backup/restore";
import { saveBackupSettings } from "@/server/backup/settings";
import { scheduleRestart } from "@/server/restart";

/** Legt sofort eine Sicherung an. */
export async function createManualBackup(): Promise<ActionState> {
  await requirePermission("backup.manage");
  const { t } = await getI18n();
  try {
    const info = await createBackup("manual");
    await audit("backup.create", { target: info.name });
    revalidatePath("/admin/backup");
    return { ok: true, message: t("backup.created") };
  } catch (error) {
    console.error("[backup] Manuelle Sicherung fehlgeschlagen:", error);
    return { error: t("backup.errors.createFailed") };
  }
}

export async function removeBackup(formData: FormData) {
  await requirePermission("backup.manage");
  const name = String(formData.get("name") ?? "");
  if (isBackupName(name) && deleteBackup(name)) await audit("backup.delete", { target: name });
  revalidatePath("/admin/backup");
}

/** Stellt eine Sicherung wieder her: prüfen, aktuellen Stand sichern, vormerken – dann übernimmt der Launcher nach dem Neustart. */
export async function restoreBackup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("backup.manage");
  const { t } = await getI18n();
  const name = String(formData.get("name") ?? "");
  try {
    await stageRestore(name);
  } catch (error) {
    if (error instanceof RestoreError) return { error: t(`backup.errors.${error.code}`) };
    console.error("[backup] Wiederherstellung fehlgeschlagen:", error);
    return { error: t("backup.errors.restoreFailed") };
  }
  await audit("backup.restore", { target: name });
  scheduleRestart();
  return { ok: true, message: t("backup.restoring") };
}

const settingsSchema = z.object({
  hour: z.coerce.number().int().min(0).max(23),
  keep: z.coerce.number().int().min(1).max(365),
});

export async function saveBackupPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("settings.manage");
  const { t } = await getI18n();
  const parsed = settingsSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  await saveBackupSettings({ enabled: formData.get("enabled") === "on", hour: parsed.data.hour, keep: parsed.data.keep });
  revalidatePath("/admin/backup");
  return { ok: true, message: t("common.saved") };
}
