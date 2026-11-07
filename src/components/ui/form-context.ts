"use client";

import { createContext, useContext } from "react";

/**
 * Gemeinsamer Zustand zwischen `Form` (form-frame.tsx) und den Feldbausteinen (form.tsx): Rückgabe der Aktion (Feldfehler, Fehlermeldung), Wartezustand.
 * Eigene Datei, damit sich die beiden nicht gegenseitig importieren.
 */
export type FormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
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
