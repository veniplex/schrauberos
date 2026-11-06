import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import * as tar from "tar";
import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { backupPath } from "@/server/backup/core";

export const dynamic = "force-dynamic";

/**
 * Lädt eine Sicherung als Archiv (.tar) herunter: Datenbank-Schnappschuss und alle Dateien. Gestreamt – es entsteht keine
 * Zwischendatei, auch bei vielen Gigabyte. Nur mit Recht backup.manage; der Name muss dem festen Muster entsprechen.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.can("backup.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { name } = await params;
  const dir = backupPath(name);
  if (!dir || !existsSync(dir)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await audit("backup.download", { target: name });
  // Datenbank (bereits gzip) und Belege sind kaum weiter komprimierbar: ein einfaches tar genügt
  const pack = tar.c({ cwd: dir, portable: true }, ["."]);
  pack.on("error", (error) => console.error("[backup] Archiv konnte nicht erstellt werden:", error));
  return new Response(Readable.toWeb(Readable.from(pack)) as ReadableStream, {
    headers: { "content-type": "application/x-tar", "content-disposition": `attachment; filename="${name}.tar"`, "cache-control": "no-store" },
  });
}
