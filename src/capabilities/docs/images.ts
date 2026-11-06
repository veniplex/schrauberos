import "server-only";
import { db } from "@/server/db";
import type { AppSession } from "@/server/auth/session";
import { DOC_PERMISSIONS, type DocArea } from "./areas";
import { visiblePages } from "./access";

/** Adresse, unter der eine Seite ein Bild einbindet (Markdown `![](…)`). */
export const docImageUrl = (id: string): string => `/api/docs/images/${id}`;

/**
 * Darf der Betrachter dieses Bild sehen? Bilder haben keinen eigenen Bezug zu Kapiteln; deshalb gilt die Rückwärtssuche:
 * Ein Bild ist sichtbar, wenn eine **für den Betrachter sichtbare Seite** des Bereichs es im aktuellen Inhalt einbindet. Frühere
 * Fassungen (`DocVersion`) zählen nicht – sie sind für Nicht-Bearbeiter nicht einsehbar, und so gibt ein eingeschränktes Kapitel
 * seine Bilder nicht über eine alte Fassung frei. Bilder ohne Seite (hochgeladen, noch nicht gespeichert oder nicht mehr
 * eingebunden) sehen nur Bearbeiter und Administratoren.
 */
export async function canViewDocImage(session: AppSession, image: { id: string; area: DocArea }): Promise<boolean> {
  const permissions = DOC_PERMISSIONS[image.area];
  if (!session.can(permissions.view)) return false;
  if (session.user.isAdmin || session.can(permissions.edit)) return true;
  const page = await db.docPage.findFirst({
    where: { area: image.area, content: { contains: docImageUrl(image.id) }, ...visiblePages(session, image.area) },
    select: { id: true },
  });
  return page !== null;
}
