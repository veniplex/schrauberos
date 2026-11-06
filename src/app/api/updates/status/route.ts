import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { readState } from "@/lib/updates/store";
import { runningMeta, updaterEnabled } from "@/modules/admin/updates/config";

export const dynamic = "force-dynamic";

/** Laufende Version und Ergebnis des letzten Updates – die Update-Seite fragt das nach dem Neustart ab. */
export async function GET() {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.can("updates.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ version: runningMeta().version, last: updaterEnabled() ? readState().last : null });
}
