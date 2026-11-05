import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireSession, type AppSession } from "@/server/auth/session";
import { DOC_PERMISSIONS, isDocArea, type DocArea } from "./areas";

/** Validiert den Bereich aus der URL und prüft das Leserecht. Liefert zusätzlich, ob bearbeitet werden darf. */
export async function requireDocArea(areaParam: string): Promise<{ area: DocArea; session: AppSession; canEdit: boolean }> {
  if (!isDocArea(areaParam)) notFound();
  const session = await requireSession();
  if (!session.can(DOC_PERMISSIONS[areaParam].view)) redirect("/forbidden");
  return { area: areaParam, session, canEdit: session.can(DOC_PERMISSIONS[areaParam].edit) };
}

/** Wie requireDocArea, verlangt aber das Bearbeitungsrecht. */
export async function requireDocEdit(areaParam: string): Promise<{ area: DocArea; session: AppSession }> {
  const { area, session, canEdit } = await requireDocArea(areaParam);
  if (!canEdit) redirect("/forbidden");
  return { area, session };
}
