import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth/session";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
import { backupsDir, markTempActive } from "@/server/backup/core";
import { checkAnnouncedLength, receiveBody } from "@/server/backup/receive";
import { importBackupFile, RestoreError } from "@/server/backup/restore";
import { isBehindProxy } from "@/server/auth/network";
import { isSameOriginUpload } from "@/server/request-guard";
import { startupState } from "@/server/startup-state";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { tooLarge: 413, diskFull: 507, wrongKey: 422, keyFormat: 422, keyRequired: 422 };

/**
 * Nimmt eine Sicherungsdatei als rohen Request-Body entgegen (kein Server-Action-Limit, die Datei wird gestreamt) und legt sie
 * nach der Prüfung in die Liste. Schutz vor Fremdaufrufen: Sitzung + Recht, gleiche Herkunft und ein eigener Header.
 * Schutz der Platte: Die angekündigte Länge muss (einmal als Datei, einmal entpackt) samt Reserve in den freien Platz passen; während des Empfangs werden die
 * Bytes gezählt (Obergrenze, auch ohne Längenangabe) und der freie Platz laufend geprüft – beim Überschreiten wird abgebrochen und die halbe Datei gelöscht.
 * Ein verschlüsseltes Off-Site-Backup (`.sobk`) braucht den Wiederherstellungsschlüssel im Kopf `x-recovery-key` (nie in der Adresse).
 *
 * Diese Route läuft **nicht** durch den Proxy (Matcher in `src/proxy.ts`): Der Proxy puffert den Body und schneidet ihn bei 10 MiB stumm ab.
 * Deshalb beantwortet sie den Zustand „Neuinstallation nötig“ (fremde Datenbank, die App fasst sie nicht an) selbst mit 503 – vor allem anderen.
 */
export async function POST(request: NextRequest) {
  const startup = startupState().status;
  if (startup === "reinstall") {
    return NextResponse.json({ status: "reinstall" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "3600" } });
  }
  // Der Start (Migrationen) läuft noch: keine Anfrage an eine noch nicht migrierte Datenbank (wie der Proxy, an dem diese Route vorbeiläuft)
  if (startup !== "ready") return NextResponse.json({ status: "starting" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.can("backup.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isSameOriginUpload(request, await isBehindProxy())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!request.body) return NextResponse.json({ error: "notBackup" }, { status: 400 });

  mkdirSync(backupsDir(), { recursive: true });
  const early = await checkAnnouncedLength(request.headers.get("content-length"));
  if (early) return NextResponse.json({ error: early }, { status: STATUS[early] });

  const tmp = path.join(backupsDir(), `.upload-${randomBytes(6).toString("hex")}`);
  const release = markTempActive(tmp); // das Aufräumen liegengebliebener Zwischendateien fasst sie nicht an, solange der Upload läuft
  try {
    await receiveBody(request.body, tmp);
    const name = await importBackupFile(tmp, undefined, { recoveryKey: request.headers.get("x-recovery-key") });
    await audit("backup.upload", { target: name });
    return NextResponse.json({ name });
  } catch (error) {
    rmSync(tmp, { force: true });
    // Fehlgeschlagene Importe gehören ins Audit-Log (nur der Fehlercode, nie Dateiinhalt, -name oder Schlüssel)
    if (error instanceof RestoreError) {
      await audit("backup.uploadFailed", { target: error.code });
      return NextResponse.json({ error: error.code }, { status: STATUS[error.code] ?? 422 });
    }
    logError("backup:upload", error);
    await audit("backup.uploadFailed", { target: "uploadFailed" });
    return NextResponse.json({ error: "uploadFailed" }, { status: 500 });
  } finally {
    release();
  }
}
