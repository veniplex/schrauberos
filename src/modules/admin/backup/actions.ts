"use server";

import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { formObject } from "@/lib/forms";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
import { createBackup, deleteBackup, isBackupName } from "@/server/backup/core";
import { RestoreError, stageRestore } from "@/server/backup/restore";
import { BACKUP_KINDS } from "@/server/backup/kinds";
import { RETENTION_MAX_DAYS, RETENTION_MAX_KEEP, saveBackupSettings, type BackupRetention } from "@/server/backup/settings";
import { jobRunner } from "@/server/jobs";
import { defineAction, defineOperation, fail, failField } from "@/server/operations";
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

/** „Jetzt erneut versuchen“ in der Fehlermeldung: führt den Job `backup.auto` sofort aus (Uhrzeit und „heute schon“ gelten dann nicht). */
const runAutoBackupOperation = defineOperation({
  name: "admin.backup.runAuto",
  permission: "backup.manage",
  input: none,
  audit: "backup.runNow",
  transaction: false,
  run: async ({ audit: setAudit }) => {
    const result = await jobRunner().runNow("backup.auto");
    if (!result) fail("busy", "backup.errors.busy");
    if (result.status === "error") fail("failed", "backup.errors.createFailed");
    setAudit({ target: "backup.auto" });
    return { ran: true };
  },
});

export const runAutoBackupNow = defineAction(runAutoBackupOperation, { revalidate: ["/admin/backup"], message: "backup.retry.done" });

export const createManualBackup = defineAction(createManualBackupOperation, { revalidate: ["/admin/backup"], message: "backup.created" });

const removeBackupOperation = defineOperation({
  name: "admin.backup.remove",
  permission: "backup.manage",
  input: z.object({ name: z.string().min(1).max(200) }),
  audit: "backup.delete",
  transaction: false,
  run: async ({ input, audit: setAudit }) => {
    if (!isBackupName(input.name) || !(await deleteBackup(input.name))) fail("notFound", "backup.errors.notFound");
    setAudit({ target: input.name });
    return { name: input.name };
  },
});

export const removeBackup = defineAction(removeBackupOperation, { revalidate: ["/admin/backup"], message: "common.deleted" });

/**
 * Stellt eine Sicherung wieder her: prüfen, aktuellen Stand sichern, vormerken – dann übernimmt der Launcher nach dem Neustart. Optional mit dem Wiederherstellungsschlüssel:
 * Er öffnet die im Backup mitgelieferte Kopie von secret.key, die dann im selben Schritt eingesetzt wird (alle Geheimnisse bleiben lesbar). Ohne Schlüssel werden nicht lesbare
 * Geheimnisse (Zwei-Faktor-Anmeldung, Update-Token, Zugangsdaten …) beim Start zurückgesetzt. Der Schlüssel steht nie im Audit-Log.
 */
const restoreBackupOperation = defineOperation({
  name: "admin.backup.restore",
  permission: "backup.manage",
  input: z.object({ name: z.string().min(1).max(200), recoveryKey: z.string().max(200).optional() }),
  audit: "backup.restore",
  transaction: false,
  run: async ({ input, audit: setAudit, afterCommit }) => {
    let secretKeyRestored = false;
    try {
      secretKeyRestored = (await stageRestore(input.name, { recoveryKey: input.recoveryKey })).secretKeyRestored;
    } catch (error) {
      if (error instanceof RestoreError) {
        if (error.code === "keyFormat" || error.code === "wrongKey") failField("recoveryKey", `backup.errors.${error.code}` as MessageKey);
        fail("failed", `backup.errors.${error.code}` as MessageKey);
      }
      logError("backup", error);
      fail("failed", "backup.errors.restoreFailed");
    }
    setAudit({ target: secretKeyRestored ? `${input.name} · mit Wiederherstellungsschlüssel` : input.name });
    afterCommit(() => scheduleRestart());
    return { name: input.name };
  },
  onFailure: ({ input, principal, failure }) =>
    failure?.code === "failed" || (failure?.code === "invalid" && failure.fields?.recoveryKey)
      ? audit("backup.restoreFailed", { target: input.name, actor: { id: principal.user.id, name: principal.user.name } })
      : undefined,
});

export const restoreBackup = defineAction(restoreBackupOperation, { message: "backup.restoring" });

/**
 * Ganze Zahl von 0 bis `max`. Ein **leeres** Feld ist ein Fehler, nie 0: `Number("")` ist 0, und bei der Aufbewahrung hieße 0 „unbegrenzt“ (Datenschutz: Speicherbegrenzung) –
 * ein versehentlich geleertes Feld darf nicht stillschweigend die Löschfristen abschalten.
 */
const retentionField = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.coerce.number().int().min(0).max(max));
/** Aufbewahrung je Art als flache Formularfelder `keep_<art>` und `days_<art>` (0 = unbegrenzt). */
const retentionShape: Record<string, ReturnType<typeof retentionField>> = Object.fromEntries(
  BACKUP_KINDS.flatMap((kind) => [
    [`keep_${kind}`, retentionField(RETENTION_MAX_KEEP)],
    [`days_${kind}`, retentionField(RETENTION_MAX_DAYS)],
  ]),
);

const planInput = z.object({
  enabled: z.boolean(),
  hour: retentionField(23),
  ...retentionShape,
});

const saveBackupPlanOperation = defineOperation({
  name: "admin.backup.savePlan",
  permission: "settings.manage",
  input: planInput,
  audit: "settings.backupPlan",
  run: async ({ input, tx, audit: setAudit }) => {
    const fields = input as Record<string, unknown>;
    const retention = Object.fromEntries(BACKUP_KINDS.map((kind) => [kind, { keep: Number(fields[`keep_${kind}`]), days: Number(fields[`days_${kind}`]) }])) as BackupRetention;
    await saveBackupSettings({ enabled: input.enabled, hour: input.hour, retention }, tx);
    setAudit({ target: `enabled=${input.enabled} hour=${input.hour} ${BACKUP_KINDS.map((k) => `${k}=${retention[k].keep}/${retention[k].days}d`).join(" ")}` });
    return { saved: true };
  },
});

export const saveBackupPlan = defineAction(saveBackupPlanOperation, {
  form: (fd) => ({ ...formObject(fd), enabled: fd.get("enabled") === "on" }),
  revalidate: ["/admin/backup"],
  message: "common.saved",
});
