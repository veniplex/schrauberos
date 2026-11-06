"use server";

import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
import { createBackup } from "@/server/backup/core";
import { defineAction, defineOperation, fail } from "@/server/operations";
import { scheduleRestart } from "@/server/restart";
import { setSecret } from "@/server/settings";
import { runningMeta, UPDATE_TOKEN_KEY } from "./config";
import { installRelease } from "./install";
import { UpdateError } from "./manifest";
import { checkLatestRelease } from "./releases";

/** Fragt GitHub sofort nach der neuesten Version (statt den Zwischenspeicher zu verwenden). Reine Abfrage, ändert keine Daten. */
const checkForUpdatesOperation = defineOperation({
  name: "admin.updates.check",
  permission: "updates.manage",
  input: z.object({}),
  audit: false,
  auditReason: "Reine Abfrage der neuesten Version bei GitHub; ändert keine Daten der Anwendung.",
  transaction: false,
  run: async () => {
    await checkLatestRelease(true);
    return { checked: true };
  },
});

export const checkForUpdates = defineAction(checkForUpdatesOperation, { revalidate: ["/admin/updates"] });

/** Installiert die angezeigte Version und startet die Anwendung neu (der Launcher übernimmt). */
const installUpdateOperation = defineOperation({
  name: "admin.updates.install",
  permission: "updates.manage",
  input: z.object({ version: z.string().max(60) }),
  audit: "system.update",
  transaction: false,
  run: async ({ input, audit: setAudit, afterCommit }) => {
    const from = runningMeta().version;
    try {
      // Immer frisch prüfen und nur genau die angezeigte Version installieren (nicht „irgendeine neuere“)
      const check = await checkLatestRelease(true);
      if ("error" in check) throw new UpdateError(check.error);
      if (check.release.version !== input.version) throw new UpdateError("notNewer");
      // Sicherheitsnetz: vor jedem Update ein Backup – scheitert es, wird nicht aktualisiert
      try {
        await createBackup("pre-update");
      } catch (error) {
        logError("updates", error);
        throw new UpdateError("backupFailed");
      }
      await installRelease(check.release);
    } catch (error) {
      const code = error instanceof UpdateError ? error.code : "network";
      logError("updates", error);
      fail("failed", `updates.errors.${code}` as MessageKey, { code });
    }
    setAudit({ target: `${from} → ${input.version}` });
    afterCommit(() => scheduleRestart());
    return { version: input.version };
  },
  onFailure: ({ input, principal, failure }) =>
    failure?.code === "failed" ? audit("system.updateFailed", { target: `${input.version}: ${String(failure.params?.code ?? "network")}`, actor: { id: principal.user.id, name: principal.user.name } }) : undefined,
});

export const installUpdate = defineAction(installUpdateOperation, { message: "updates.install.restarting" });

/** Speichert (oder entfernt) das GitHub-Token für die Update-Prüfung; leere Eingabe lässt das vorhandene Token unverändert. Das Token selbst steht nie im Audit-Log. */
const saveUpdateTokenOperation = defineOperation({
  name: "admin.updates.saveToken",
  permission: "settings.manage",
  input: z.object({ token: z.string().trim().max(300).optional(), remove: z.boolean() }),
  audit: "settings.updateToken",
  run: async ({ input, tx, audit: setAudit, afterCommit }) => {
    // Geheimnis verschlüsselt (setSecret); Entfernen und Hinterlegen unterscheidet das Audit nur durch das Ziel, nie durch den Wert
    if (input.remove) await setSecret(UPDATE_TOKEN_KEY, null, tx);
    else if (input.token) await setSecret(UPDATE_TOKEN_KEY, input.token, tx);
    setAudit({ target: input.remove ? "removed" : input.token ? "set" : "unchanged" });
    afterCommit(() => checkLatestRelease(true));
    return { saved: true };
  },
});

export const saveUpdateToken = defineAction(saveUpdateTokenOperation, {
  form: (fd) => ({ token: String(fd.get("token") ?? ""), remove: fd.get("remove") === "on" }),
  revalidate: ["/admin/updates"],
  message: "common.saved",
});
