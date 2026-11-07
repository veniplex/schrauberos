import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse, type NextRequest } from "next/server";
import { DISK_RESERVE_BYTES, freeBytes } from "@/lib/disk";
import { getSession } from "@/server/auth/session";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
import { backupsDir } from "@/server/backup/core";
import { importBackupFile, RestoreError } from "@/server/backup/restore";
import { isSameOriginUpload } from "@/server/request-guard";
import { startupState } from "@/server/startup-state";

export const dynamic = "force-dynamic";

/** Größtes angenommenes Backup-Archiv (Byte). Darüber wird mitten im Strom abgebrochen – auch wenn der Absender keine Länge angibt. */
const BACKUP_UPLOAD_MAX_BYTES = 100 * 1024 ** 3;
/** Alle so viel empfangenen Bytes wird der freie Platz erneut geprüft. */
const SPACE_CHECK_EVERY = 64 * 1024 * 1024;

const STATUS: Record<string, number> = { tooLarge: 413, diskFull: 507 };

/**
 * Nimmt eine Sicherungsdatei als rohen Request-Body entgegen (kein Server-Action-Limit, die Datei wird gestreamt) und legt sie
 * nach der Prüfung in die Liste. Schutz vor Fremdaufrufen: Sitzung + Recht, gleiche Herkunft und ein eigener Header.
 * Schutz der Platte: Die angekündigte Länge muss (einmal als Datei, einmal entpackt) samt Reserve in den freien Platz passen; während des Empfangs werden die
 * Bytes gezählt (Obergrenze, auch ohne Längenangabe) und der freie Platz laufend geprüft – beim Überschreiten wird abgebrochen und die halbe Datei gelöscht.
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
  if (!session || session.user.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.can("backup.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isSameOriginUpload(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!request.body) return NextResponse.json({ error: "notBackup" }, { status: 400 });

  mkdirSync(backupsDir(), { recursive: true });
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > BACKUP_UPLOAD_MAX_BYTES) return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  const free = await freeBytes(backupsDir());
  if (free !== null && Number.isFinite(announced) && announced > 0 && announced * 2 + DISK_RESERVE_BYTES > free) return NextResponse.json({ error: "diskFull" }, { status: 507 });

  const tmp = path.join(backupsDir(), `.upload-${randomBytes(6).toString("hex")}`);
  let received = 0;
  let checkedAt = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > BACKUP_UPLOAD_MAX_BYTES) return callback(new RestoreError("tooLarge"));
      if (received - checkedAt < SPACE_CHECK_EVERY) return callback(null, chunk);
      checkedAt = received;
      freeBytes(backupsDir()).then(
        (left) => (left !== null && left < DISK_RESERVE_BYTES + chunk.length ? callback(new RestoreError("diskFull")) : callback(null, chunk)),
        () => callback(null, chunk),
      );
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]), counter, createWriteStream(tmp));
    const name = await importBackupFile(tmp);
    await audit("backup.upload", { target: name });
    return NextResponse.json({ name });
  } catch (error) {
    rmSync(tmp, { force: true });
    // Fehlgeschlagene Importe gehören ins Audit-Log (nur der Fehlercode, nie Dateiinhalt oder -name)
    if (error instanceof RestoreError) {
      await audit("backup.uploadFailed", { target: error.code });
      return NextResponse.json({ error: error.code }, { status: STATUS[error.code] ?? 422 });
    }
    logError("backup:upload", error);
    await audit("backup.uploadFailed", { target: "uploadFailed" });
    return NextResponse.json({ error: "uploadFailed" }, { status: 500 });
  }
}
