import type { Prisma } from "@/generated/prisma/client";

/** Wer schaut in die Dokumentation? `unrestricted`: Administratoren und Bearbeiter sehen alles. */
export type DocViewer = { unrestricted: boolean; roleIds: readonly string[] };

/**
 * Welche Kapitel (DocCategory) darf der Betrachter lesen? Ein Kapitel ohne Rollen steht allen mit Leserecht offen, sonst nur den
 * genannten Rollen.
 */
export function chapterFilter(viewer: DocViewer): Prisma.DocCategoryWhereInput {
  if (viewer.unrestricted) return {};
  return { OR: [{ roles: { none: {} } }, { roles: { some: { roleId: { in: [...viewer.roleIds] } } } }] };
}

/** Seiten ohne Kapitel sind offen, sonst gilt die Sichtbarkeit des Kapitels. */
export function pageFilter(viewer: DocViewer): Prisma.DocPageWhereInput {
  return viewer.unrestricted ? {} : { OR: [{ categoryId: null }, { category: chapterFilter(viewer) }] };
}
