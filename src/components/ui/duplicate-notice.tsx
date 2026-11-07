"use client";

import type { ReactNode } from "react";
import { LinkButton, SubmitButton } from "./buttons";
import { useFormContext } from "./form-context";
import { Alert } from "./layout";

/**
 * Warnung „gibt es schon“ in einem Formular (zum Beispiel ein Kennzeichen, das schon erfasst ist) – eine **Warnung mit Bestätigung**, keine Sperre.
 *
 * Die Aktion meldet den Fund als Feldfehler und liefert dazu `state.data` (`duplicateId` und Anzeigetexte, siehe `OperationFailure.data`); dieser Baustein zeigt dann
 * die Meldung, den Verweis auf den vorhandenen Datensatz (neuer Tab, das ausgefüllte Formular bleibt offen) und den Knopf „Trotzdem …“, der das Formular noch einmal mit
 * `allowDuplicate=1` absendet. Gehört in das `Form`/`FormCard`, dessen Aktion das Feld `allowDuplicate` kennt.
 */
export function DuplicateNotice({
  title,
  message,
  openLabel,
  openHref,
  anywayLabel,
}: {
  title: ReactNode;
  /** Text aus den Zusatzangaben der Aktion */
  message: (data: Record<string, string>) => ReactNode;
  openLabel: ReactNode;
  openHref: (id: string) => string;
  anywayLabel: ReactNode;
}) {
  const data = useFormContext()?.state.data;
  if (!data?.duplicateId) return null;
  return (
    <Alert tone="warning">
      <div className="flex flex-col gap-3">
        <div>
          <p className="font-medium">{title}</p>
          <p>{message(data)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton external href={openHref(data.duplicateId)} target="_blank" rel="noreferrer" size="sm">
            {openLabel}
          </LinkButton>
          <SubmitButton variant="secondary" size="sm" name="allowDuplicate" value="1">
            {anywayLabel}
          </SubmitButton>
        </div>
      </div>
    </Alert>
  );
}
