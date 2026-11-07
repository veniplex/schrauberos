"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentProps, HTMLAttributes, ReactNode, Ref, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useI18n } from "@/i18n/client";
import { FieldContext, formErrorId, useField, useFormContext, type FieldContextValue } from "./form-context";

/** Rückgabe-Zustand aller Formular-Server-Actions (für useActionState). */
export type ActionState = {
  ok?: boolean;
  /** Allgemeine Fehlermeldung (bereits übersetzt) */
  error?: string;
  /** Feldfehler: name -> übersetzte Meldung */
  fieldErrors?: Record<string, string>;
  /** Erfolgsmeldung (bereits übersetzt) */
  message?: string;
  /** Die Anfrage hat den Server nicht erreicht (nur im Browser gesetzt) */
  network?: boolean;
};

/** Beschriftung eines Feldes oder einer Feldgruppe (`as="legend"` in einem fieldset). */
export function FieldLabel({ as: Tag = "p", className, children, ...props }: { as?: "p" | "legend" | "span"; className?: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...props} className={clsx("field-label", className)}>
      {children}
    </Tag>
  );
}

export function FieldHint({ className, id, children }: { className?: string; id?: string; children: ReactNode }) {
  return (
    <p id={id} className={clsx("field-hint", className)}>
      {children}
    </p>
  );
}

/**
 * Fehlertext eines Feldes. Außerhalb eines `Form` ist er eine Live-Region (wird angesagt); innerhalb sagt die Fehlerzusammenfassung
 * (`FormErrorSummary`) alle Fehler gesammelt an – eine zweite Ansage je Feld wäre doppelt.
 */
export function FieldError({ as: Tag = "p", className, id, children }: { as?: "p" | "span"; className?: string; id?: string; children: ReactNode }) {
  const inForm = useFormContext() !== null;
  return (
    <Tag id={id} role={inForm ? undefined : "alert"} className={clsx("field-error", className)}>
      {children}
    </Tag>
  );
}

/**
 * Feld mit Beschriftung. Erzeugt die Id selbst (`useId`) und gibt sie über den Kontext an das Eingabeelement darin weiter
 * (`Input`, `Select`, `Textarea`, `SearchCombobox` …); das setzt `aria-describedby` (Fehler und Hinweis), `aria-invalid` und `aria-required`.
 *
 * - `name`: Feldname im Formular – der Fehler kommt dann von selbst aus dem umgebenden `Form` (statt `error`).
 * - `htmlFor`: eine feste Id (sonst automatisch). Wer eine eigene `id` am Eingabeelement setzt, trägt sie hier ein.
 * - `group`: Gruppe von Eingaben (Kontrollkästchen, Farbwahl, mehrere Felder): `fieldset` mit `legend`, Fehler/Hinweis hängen an der Gruppe.
 * - Fehler **und** Hinweis bleiben nebeneinander sichtbar (der Fehler zuerst).
 */
export function Field({
  label,
  htmlFor,
  name,
  error,
  hint,
  required,
  group,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  name?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  group?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const auto = useId();
  const form = useFormContext();
  const id = htmlFor ?? auto;
  const message = error ?? (name ? form?.state.fieldErrors?.[name] : undefined);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [message ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const value = useMemo<FieldContextValue>(
    () => ({ id, labelId: `${id}-label`, describedBy, invalid: Boolean(message), required: Boolean(required) }),
    [id, describedBy, message, required],
  );
  const mark = required ? (
    <span aria-hidden className="required-mark ml-0.5 text-danger-ink">
      *
    </span>
  ) : null;
  const notes = (
    <>
      {message ? <FieldError id={errorId}>{message}</FieldError> : null}
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
    </>
  );
  if (group) {
    return (
      <FieldContext.Provider value={value}>
        <fieldset className={clsx("m-0 min-w-0 border-0 p-0", className)} aria-describedby={describedBy} data-field={name}>
          <legend id={value.labelId} className="field-label p-0">
            {label}
            {mark}
          </legend>
          {children}
          {notes}
        </fieldset>
      </FieldContext.Provider>
    );
  }
  return (
    <FieldContext.Provider value={value}>
      <div className={className} data-field={name}>
        <label id={value.labelId} className="field-label" htmlFor={id}>
          {label}
          {mark}
        </label>
        {children}
        {notes}
      </div>
    </FieldContext.Provider>
  );
}

type WithInvalid = { invalid?: boolean };

/**
 * Id, Beschreibung und Fehlerzustand eines Eingabeelements: ausdrückliche Eigenschaften gewinnen, sonst das umgebende `Field`. Ohne `Field` (Zeilenformulare, Tabellenzellen)
 * gilt der Fehler zum `name` aus dem umgebenden `Form` (`FormFieldError` zeigt den Text mit der passenden Id).
 */
function useFieldAttributes(props: {
  id?: string;
  name?: string;
  invalid?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean | "true" | "false";
}): { id: string | undefined; "aria-describedby": string | undefined; "aria-invalid": true | undefined; "aria-required": boolean | "true" | "false" | undefined } {
  const field = useField();
  const form = useFormContext();
  const bare = !field && props.name ? form?.state.fieldErrors?.[props.name] : undefined;
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy ?? (bare && props.name ? formErrorId(props.name) : undefined),
    "aria-invalid": (props.invalid ?? field?.invalid ?? Boolean(bare)) ? true : undefined,
    "aria-required": props["aria-required"] ?? (field?.required ? true : undefined),
  };
}

/** Touch-Gerät oder schmaler Bildschirm (gleiche Bedingung wie die Tokens `--tap`/`--input-font` in tokens.css) */
const isTouchLayout = () => window.matchMedia("(pointer: coarse), (max-width: 1023px)").matches;

/** Setzt eine Referenz (Funktion oder Objekt) – für zusammengeführte Referenzen. */
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * `autoFocus` nur am Desktop und nur **einmal beim Einhängen**: Auf Touch-Geräten springt sonst die Tastatur auf und verdeckt das Formular; ein
 * Fokus bei jedem Rendern (Referenzfunktion im Rumpf) risse den Fokus nach jedem Neuzeichnen zurück ins Feld. Eine übergebene `ref` bleibt erhalten.
 */
function useDesktopAutoFocus<T extends HTMLElement>(autoFocus: boolean | undefined, ref: Ref<T> | undefined) {
  const element = useRef<T | null>(null);
  const wanted = useRef(autoFocus);
  useEffect(() => {
    if (wanted.current && !isTouchLayout()) element.current?.focus();
  }, []);
  return useCallback(
    (el: T | null) => {
      element.current = el;
      assignRef(ref, el);
    },
    [ref],
  );
}

/** Bildschirmtastatur eines Zahlenfeldes: `decimal` bei Nachkommastellen (`step` mit Punkt oder `any`), sonst `numeric`. */
export function numberInputMode(step: string | number | undefined): "decimal" | "numeric" {
  const text = String(step ?? "");
  return text === "any" || /\./.test(text) ? "decimal" : "numeric";
}

/**
 * Eingabefeld. Zahlenfelder (`type="number"`) bekommen von selbst die passende Bildschirmtastatur (`inputMode` numeric bzw. decimal bei
 * Nachkommastellen), und `autoFocus` wirkt nur am Desktop und nur einmal – auf Touch-Geräten springt sonst die Tastatur auf und verdeckt das Formular.
 * Id, `aria-describedby`, `aria-invalid` und `aria-required` kommen vom umgebenden `Field`.
 */
export function Input({ invalid, className, autoFocus, inputMode, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & WithInvalid & { ref?: Ref<HTMLInputElement> }) {
  const mode = inputMode ?? (props.type === "number" ? numberInputMode(props.step) : undefined);
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  const attributes = useFieldAttributes({ id: props.id, name: props.name, invalid, "aria-describedby": props["aria-describedby"], "aria-required": props["aria-required"] });
  return <input {...props} {...attributes} inputMode={mode} ref={setRef} className={clsx("input", className)} />;
}

/** Suchfeld mit Lupe (für Listen und Filter). */
export function SearchInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <div className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input enterKeyHint="search" inputMode="search" {...props} type="search" className="input pl-9" />
    </div>
  );
}

/** Kontrollkästchen mit Beschriftung (und optionalem Hinweis). */
export function Checkbox({
  label,
  hint,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { label: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex min-h-(--tap-row) min-w-(--tap-row) items-start gap-2 py-[max(0px,calc((var(--tap-row)_-_1.25rem)/2))] text-sm", className)}>
      <input {...props} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      <span>
        {label}
        {hint ? <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Farbauswahl. */
export function ColorInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...props} type="color" className={clsx("h-(--tap) w-14 cursor-pointer rounded-md border border-control bg-surface p-1", className)} />;
}

const MEGABYTE = 1024 * 1024;

/**
 * Dateiauswahl. Prüft die Größe **vor dem Absenden** (`maxBytes`, Standard 10 MB): Eine zu große Datei wird abgelehnt, das Feld geleert und
 * „Datei zu groß (max. 10 MB)“ angezeigt – statt einer generischen Fehlerseite des Servers. `onReject` übernimmt die Meldung selbst.
 */
export function FileInput({ className, maxBytes = 10 * MEGABYTE, onReject, onChange, ref, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { ref?: Ref<HTMLInputElement>; maxBytes?: number; onReject?: (file: File) => void }) {
  const { t } = useI18n();
  const field = useField();
  const errorId = useId();
  const [tooLarge, setTooLarge] = useState(false);
  const describedBy = [props["aria-describedby"] ?? field?.describedBy, tooLarge ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <input
        {...props}
        id={props.id ?? field?.id}
        aria-describedby={describedBy}
        aria-invalid={tooLarge || field?.invalid || undefined}
        type="file"
        ref={ref}
        onChange={(event) => {
          const tooBig = Array.from(event.target.files ?? []).find((file) => file.size > maxBytes);
          // `onReject`: Der Aufrufer meldet die Ablehnung selbst (z. B. ein verstecktes Feld hinter einem Werkzeugknopf); sonst steht der Hinweis unter dem Feld
          setTooLarge(Boolean(tooBig) && !onReject);
          if (tooBig) {
            event.target.value = "";
            onReject?.(tooBig);
          } else onChange?.(event);
        }}
        className={clsx("block min-h-(--tap) w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-control file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-hover", className)}
      />
      {tooLarge ? (
        <p id={errorId} role="alert" className="field-error">
          {t("common.fileTooLarge", { max: Math.round(maxBytes / MEGABYTE) })}
        </p>
      ) : null}
    </>
  );
}

export function Select({ invalid, className, children, autoFocus, ref, ...props }: SelectHTMLAttributes<HTMLSelectElement> & WithInvalid & { ref?: Ref<HTMLSelectElement> }) {
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  const attributes = useFieldAttributes({ id: props.id, name: props.name, invalid, "aria-describedby": props["aria-describedby"], "aria-required": props["aria-required"] });
  return (
    <select {...props} {...attributes} ref={setRef} className={clsx("input", className)}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, autoFocus, ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & WithInvalid & { ref?: Ref<HTMLTextAreaElement> }) {
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  const attributes = useFieldAttributes({ id: props.id, name: props.name, invalid, "aria-describedby": props["aria-describedby"], "aria-required": props["aria-required"] });
  return <textarea {...props} {...attributes} ref={setRef} className={clsx("input", className)} />;
}

/** Farbauswahl aus Vorschlägen plus freier Wahl. `name` ist das Formularfeld, `onChange` meldet jede Änderung. Gehört in ein `Field group` (Beschriftung und Beschreibung der Gruppe). */
export function ColorPicker({
  name,
  value,
  presets,
  onChange,
  customLabel,
}: {
  name: string;
  value: string;
  presets: readonly string[];
  onChange: (color: string) => void;
  /** Zugänglicher Name der freien Farbwahl */
  customLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          aria-pressed={value.toLowerCase() === c}
          className="size-(--tap-sm) cursor-pointer rounded-full border-2 border-surface outline outline-1 outline-line-strong aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ink"
          style={{ background: c }}
        />
      ))}
      <ColorInput value={value} onChange={(e) => onChange(e.target.value)} aria-label={customLabel} className="size-(--tap-sm) w-(--tap-sm) p-0.5" />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
