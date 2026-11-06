import "server-only";
import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { requirePermission, type AppSession } from "@/server/auth/session";
import { DOC_PERMISSIONS, isDocArea, type DocArea } from "./areas";
import { chapterFilter, pageFilter } from "./visibility";

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

/** Kapitel-Filter für diese Anmeldung (siehe visibility.ts). */
export function visibleChapters(session: AppSession, area: DocArea): Prisma.DocCategoryWhereInput {
  return chapterFilter({ unrestricted: session.user.isAdmin || session.can(DOC_PERMISSIONS[area].edit), roleIds: session.user.roleIds });
}

/** Seiten-Filter für diese Anmeldung (siehe visibility.ts). */
export function visiblePages(session: AppSession, area: DocArea): Prisma.DocPageWhereInput {
  return pageFilter({ unrestricted: session.user.isAdmin || session.can(DOC_PERMISSIONS[area].edit), roleIds: session.user.roleIds });
}
