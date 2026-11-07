import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
import { isBehindProxy } from "@/server/auth/network";
import { backupsDir, markTempActive } from "@/server/backup/core";
import { checkAnnouncedLength, receiveBody } from "@/server/backup/receive";
import { importBackupFile, RestoreError, stageRestore } from "@/server/backup/restore";
import { db } from "@/server/db";
import { isSameOriginUpload } from "@/server/request-guard";
import { scheduleRestart } from "@/server/restart";
import { checkSetupToken } from "@/server/setup-token";
import { startupState } from "@/server/startup-state";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { tooLarge: 413, diskFull: 507, wrongKey: 422, keyFormat: 422, keyRequired: 422, noWrappedKey: 422 };

/**
 * Wiederherstellung **in der Einrichtung** (frisches Volume, vorhandenes Backup): Backup-Datei (.tar oder verschlüsselte .sobk) als roher Request-Body, dazu im Kopf
 * `x-setup-token` (Einrichtungs-Token) und optional `x-recovery-key` (Wiederherstellungsschlüssel – nie in der Adresse). Ablauf: Token prüfen (Pflicht, gedrosselt, **vor** dem
 * Lesen des Bodys) → Datei übernehmen und prüfen → Wiederherstellung vormerken (mit dem Schlüssel samt secret.key) → Neustart; den Austausch übernimmt der Launcher.
 *
 * Das Token ist hier genauso Pflicht wie bei der Ersteinrichtung: Sonst ließe sich der Schutz der Ersteinrichtung über ein importiertes Backup umgehen (das Backup bringt seine
 * eigenen Administratoren mit). Nur solange noch kein Benutzer existiert – danach 409. Wie die Upload-Route läuft sie **nicht** durch den Proxy (Body-Grenze) und beantwortet
 * den Startzustand selbst.
 */
export async function POST(request: NextRequest) {
  const startup = startupState().status;
  if (startup === "reinstall") return NextResponse.json({ status: "reinstall" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "3600" } });
  if (startup !== "ready") return NextResponse.json({ status: "starting" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
  if ((await db.user.count()) > 0) return NextResponse.json({ error: "done" }, { status: 409 });
  if (!isSameOriginUpload(request, await isBehindProxy())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const token = checkSetupToken(request.headers.get("x-setup-token") ?? "");
  if (!token.ok) {
    return token.reason === "throttled"
      ? NextResponse.json({ error: "tokenThrottled", retryAfterSeconds: token.retryAfterSeconds }, { status: 429, headers: { "retry-after": String(token.retryAfterSeconds) } })
      : NextResponse.json({ error: "token" }, { status: 403 });
  }
  if (!request.body) return NextResponse.json({ error: "notBackup" }, { status: 400 });

  mkdirSync(backupsDir(), { recursive: true });
  const early = await checkAnnouncedLength(request.headers.get("content-length"));
  if (early) return NextResponse.json({ error: early }, { status: STATUS[early] });

  const recoveryKey = request.headers.get("x-recovery-key");
  const tmp = path.join(backupsDir(), `.upload-${randomBytes(6).toString("hex")}`);
  const release = markTempActive(tmp);
  try {
    await receiveBody(request.body, tmp);
    const name = await importBackupFile(tmp, undefined, { recoveryKey });
    await stageRestore(name, { recoveryKey });
    await audit("setup.restore", { actor: { id: null, name: "Einrichtung" }, target: name });
    scheduleRestart();
    return NextResponse.json({ ok: true });
  } catch (error) {
    rmSync(tmp, { force: true });
    if (error instanceof RestoreError) return NextResponse.json({ error: error.code }, { status: STATUS[error.code] ?? 422 });
    logError("setup:restore", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  } finally {
    release();
  }
}
