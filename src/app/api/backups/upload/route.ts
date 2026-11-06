import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { backupsDir } from "@/server/backup/core";
import { importBackupFile, RestoreError } from "@/server/backup/restore";

export const dynamic = "force-dynamic";

/**
 * Nimmt eine Sicherungsdatei als rohen Request-Body entgegen (kein Server-Action-Limit, die Datei wird gestreamt) und legt sie
 * nach der Prüfung in die Liste. Schutz vor Fremdaufrufen: Sitzung + Recht, gleiche Herkunft und ein eigener Header.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.can("backup.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const origin = request.headers.get("origin");
  if (request.headers.get("x-requested-with") !== "schrauberos" || (origin && new URL(origin).host !== request.headers.get("host"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!request.body) return NextResponse.json({ error: "notBackup" }, { status: 400 });

  mkdirSync(backupsDir(), { recursive: true });
  const tmp = path.join(backupsDir(), `.upload-${randomBytes(6).toString("hex")}`);
  try {
    await pipeline(Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));
    const name = await importBackupFile(tmp);
    await audit("backup.upload", { target: name });
    return NextResponse.json({ name });
  } catch (error) {
    rmSync(tmp, { force: true });
    if (error instanceof RestoreError) return NextResponse.json({ error: error.code }, { status: 422 });
    console.error("[backup] Upload fehlgeschlagen:", error);
    return NextResponse.json({ error: "uploadFailed" }, { status: 500 });
  }
}
