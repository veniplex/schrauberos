"use client";

import { useEffect, type ReactNode } from "react";
import { DraftScopeContext } from "./form-context";
import { purgeForeignDrafts } from "./form-draft";

/**
 * Bindet die Entwürfe der Formulare darunter an eine Person (siehe `DraftScopeContext`): `userId` kommt vom Anwendungsrahmen.
 *
 * Beim Öffnen des Rahmens werden **nur Entwürfe anderer Personen** verworfen. Die Anmeldeseite löscht dagegen nichts mehr: Läuft eine Sitzung ab (Leerlauf-Abmeldung) und meldet sich
 * dieselbe Person im selben Tab wieder an, bleibt ihr Entwurf erhalten (die Anmeldung führt auf dieselbe Seite zurück); ein anderer Benutzer findet nichts davon vor. Das
 * ausdrückliche Abmelden löscht weiterhin alle Entwürfe (`clearFormDrafts` im Benutzermenü).
 */
export function DraftScope({ userId, children }: { userId: string; children: ReactNode }) {
  useEffect(() => purgeForeignDrafts(userId), [userId]);
  return <DraftScopeContext.Provider value={userId}>{children}</DraftScopeContext.Provider>;
}
