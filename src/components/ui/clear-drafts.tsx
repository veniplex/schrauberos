"use client";

import { useEffect } from "react";
import { clearFormDrafts } from "./form-draft";

/**
 * Löscht beim Öffnen alle Entwürfe der Formulare (Anmeldeseite): Wer hier ankommt, hat sich abgemeldet oder ist abgelaufen – auf einem geteilten Gerät soll von der
 * Eingabe der vorigen Person nichts zurückbleiben (die Entwürfe sind außerdem je Benutzer getrennt, siehe `DraftScope`).
 */
export function ClearDrafts() {
  useEffect(() => clearFormDrafts(), []);
  return null;
}
