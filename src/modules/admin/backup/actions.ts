"use server";

import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { formObject } from "@/lib/forms";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
import { createBackup, deleteBackup, isBackupName } from "@/server/backup/core";
import { RestoreError, stageRestore } from "@/server/backup/restore";
import { saveBackupSettings } from "@/server/backup/settings";
import { defineAction, defineOperation, fail } from "@/server/operations";
import { scheduleRestart } from "@/server/restart";

const none = z.object({});

/** Legt sofort eine Sicherung an. Langer Vorgang: ohne Transaktion. */
const createManualBackupOperation = defineOperation({
  name: "admin.backup.create",
  permission: "backup.manage",
  input: none,
  audit: "backup.create",
  transaction: false,
  run: async ({ audit: setAudit }) => {
    let name: string;
    try {
      name = (await createBackup("manual")).name;
    } catch (error) {
      logError("backup", error);
      fail("failed", "backup.errors.createFailed");
    }
    setAudit({ target: name });
    return { name };
  },
  onFailure: ({ principal, failure }) => (failure?.code === "failed" ? audit("backup.createFailed", { actor: { id: principal.user.id, name: principal.user.name } }) : undefined),
});

export const createManualBackup = defineAction(createManualBackupOperation, { revalidate: ["/admin/backup"], message: "backup.created" });

const removeBackupOperation = defineOperation({
  name: "admin.backup.remove",
  permission: "backup.manage",
  input: z.object({ name: z.string().min(1).max(200) }),
  audit: "backup.delete",
  transaction: false,
  run: async ({ input, audit: setAudit }) => {
    if (!isBackupName(input.name) || !deleteBackup(input.name)) fail("notFound", "backup.errors.notFound");
    setAudit({ target: input.name });
    return { name: input.name };
  },
});

export const removeBackup = defineAction(removeBackupOperation, { revalidate: ["/admin/backup"], message: "common.deleted" });

/** Stellt eine Sicherung wieder her: prüfen, aktuellen Stand sichern, vormerken – dann übernimmt der Launcher nach dem Neustart. */
const restoreBackupOperation = defineOperation({
  name: "admin.backup.restore",
  permission: "backup.manage",
  input: z.object({ name: z.string().min(1).max(200) }),
  audit: "backup.restore",
  transaction: false,
  run: async ({ input, audit: setAudit, afterCommit }) => {
    try {
      await stageRestore(input.name);
    } catch (error) {
      if (error instanceof RestoreError) fail("failed", `backup.errors.${error.code}` as MessageKey);
      logError("backup", error);
      fail("failed", "backup.errors.restoreFailed");
    }
    setAudit({ target: input.name });
    afterCommit(() => scheduleRestart());
    return { name: input.name };
  },
  onFailure: ({ input, principal, failure }) => (failure?.code === "failed" ? audit("backup.restoreFailed", { target: input.name, actor: { id: principal.user.id, name: principal.user.name } }) : undefined),
});

export const restoreBackup = defineAction(restoreBackupOperation, { message: "backup.restoring" });

const planInput = z.object({
  enabled: z.boolean(),
  hour: z.coerce.number().int().min(0).max(23),
  keep: z.coerce.number().int().min(1).max(365),
});

const saveBackupPlanOperation = defineOperation({
  name: "admin.backup.savePlan",
  permission: "settings.manage",
  input: planInput,
  audit: "settings.backupPlan",
  run: async ({ input, tx, audit: setAudit }) => {
    await saveBackupSettings({ enabled: input.enabled, hour: input.hour, keep: input.keep }, tx);
    setAudit({ target: `enabled=${input.enabled} hour=${input.hour} keep=${input.keep}` });
    return { saved: true };
  },
});

export const saveBackupPlan = defineAction(saveBackupPlanOperation, {
  form: (fd) => ({ ...formObject(fd), enabled: fd.get("enabled") === "on" }),
  revalidate: ["/admin/backup"],
  message: "common.saved",
});
