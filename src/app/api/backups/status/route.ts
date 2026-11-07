import { NextResponse } from "next/server";
import { readPending, readRestoreResult } from "@/lib/updates/restore";
import { getSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Ob eine Wiederherstellung noch aussteht; die Backup-Seite fragt das nach dem Neustart ab. */
export async function GET() {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.can("backup.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ pending: readPending() !== null, result: readRestoreResult() });
}
