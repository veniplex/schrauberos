import "server-only";
import { notFound } from "next/navigation";
import { requirePermission, type AppSession } from "@/server/auth/session";
import { DOC_PERMISSIONS, isDocArea, type DocArea } from "./areas";

/**
 * Validiert den Bereich aus der URL und prüft das Leserecht (ausgeschaltete Funktion = 404, fehlendes Recht = /forbidden).
 * Liefert zusätzlich, ob bearbeitet werden darf.
 */
export async function requireDocArea(areaParam: string): Promise<{ area: DocArea; session: AppSession; canEdit: boolean }> {
  if (!isDocArea(areaParam)) notFound();
  const session = await requirePermission(DOC_PERMISSIONS[areaParam].view);
  return { area: areaParam, session, canEdit: session.can(DOC_PERMISSIONS[areaParam].edit) };
}

/** Wie requireDocArea, verlangt aber das Bearbeitungsrecht. */
export async function requireDocEdit(areaParam: string): Promise<{ area: DocArea; session: AppSession }> {
  if (!isDocArea(areaParam)) notFound();
  const session = await requirePermission(DOC_PERMISSIONS[areaParam].edit);
  return { area: areaParam, session };
}
