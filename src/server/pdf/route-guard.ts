import "server-only";
import { errorResponse } from "@/lib/file-delivery";
import type { Permission } from "@/modules/catalog";
import { getSession, type AppSession } from "@/server/auth/session";
import { PdfError } from "./errors";

/**
 * Gemeinsamer Anfang der PDF-Routen der Funktionen (Etikett, Auftragskarte, Terminzettel): Sitzung (kein ausstehender Passwortwechsel/zweiter Faktor) und das Recht der Sache – **bevor** irgendetwas
 * erzeugt wird (kein Rechenaufwand für Unberechtigte). Ohne Sitzung 401, ohne Recht (oder bei ausgeschalteter Funktion, dann hat die Sitzung das Recht nicht) 403; ob es die Sache **für diese Person** gibt
 * (Art. 18 DSGVO, Rechte der Entität), entscheidet danach die Abfrage der Funktion (404).
 */
export async function pdfRouteSession(permission: Permission): Promise<{ session: AppSession; response?: undefined } | { session?: undefined; response: Response }> {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return { response: errorResponse(401, "Unauthorized") };
  if (!session.can(permission)) return { response: errorResponse(403, "Forbidden") };
  return { session };
}

/** Zu viel Text oder zu viele Etiketten/Zeilen: ein klarer Fehler (422) statt eines Absturzes; alles andere ist ein echter Fehler. */
export function pdfErrorResponse(error: unknown): Response {
  if (error instanceof PdfError) return errorResponse(422, "Unprocessable");
  throw error;
}
