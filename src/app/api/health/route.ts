import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { startupState } from "@/server/startup-state";

export const dynamic = "force-dynamic";

/** Liveness/Readiness für Docker und den Launcher: erst bereit, wenn die Migrationen durch sind und die Datenbank antwortet. Ohne Authentifizierung (siehe proxy.ts). */
export async function GET() {
  const state = startupState();
  // Fremde Migrationshistorie: die App bleibt absichtlich stehen (kein Neustart-Schleife); der Launcher fällt dann sofort zurück
  if (state.status === "reinstall") return NextResponse.json({ status: "reinstall", message: state.error }, { status: 503 });
  if (state.status !== "ready") return NextResponse.json({ status: state.status }, { status: 503 });
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
