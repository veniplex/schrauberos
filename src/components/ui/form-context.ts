"use client";

import { createContext, useContext } from "react";

/**
 * Gemeinsamer Zustand zwischen `Form` (form-frame.tsx) und den Feldbausteinen (form.tsx): Rückgabe der Aktion (Feldfehler, Fehlermeldung), Wartezustand.
 * Eigene Datei, die beide importieren (keine Importschleife zwischen Rahmen und Feldern).
 */
export type FormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  /** Zusatzangaben eines Fehlers, die das Formular für einen Hinweis braucht (z. B. das Fahrzeug, dessen Kennzeichen schon vergeben ist); nur Text, bereits für die Anzeige geeignet */
  data?: Record<string, string>;
  /** Die Anfrage hat den Server nicht erreicht (Eingabe bleibt erhalten, erneut absenden genügt) */
  network?: boolean;
};

export type FormContextValue = {
  state: FormState;
  pending: boolean;
  /** Entwurf des Formulars wurde wiederhergestellt (Hinweis mit „Verwerfen“) */
  restored: boolean;
};

export const FormContext = createContext<FormContextValue | null>(null);

/** Zustand des umgebenden `Form` – `null` außerhalb (dann gelten die Eigenschaften der Bausteine selbst). */
export const useFormContext = () => useContext(FormContext);

/** Beschreibt ein Feld für die Eingabebausteine (gesetzt von `Field`). */
export type FieldContextValue = {
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
};

export const FieldContext = createContext<FieldContextValue | null>(null);

/** Das umgebende `Field` (Id, Beschreibung, Fehlerzustand) – `null`, wenn der Baustein frei steht. */
export const useField = () => useContext(FieldContext);

/** Id des Fehlertextes eines Feldes ohne eigenes `Field` (siehe `FormFieldError`) */
export const formErrorId = (name: string) => `formerror-${name}`;

/**
 * Umfang der Entwürfe: die Person, der sie gehören (Benutzer-ID aus dem Anwendungsrahmen). Entwürfe anderer Personen werden nie wiederhergestellt und beim Öffnen
 * eines Formulars verworfen. Ohne Anmeldung (Einrichtung, Anmeldeseite) leer.
 */
export const DraftScopeContext = createContext("");
