"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { FormHTMLAttributes, HTMLAttributes, ReactNode, Ref, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/** Rückgabe-Zustand aller Formular-Server-Actions (für useActionState). */
export type ActionState = {
  ok?: boolean;
  /** Allgemeine Fehlermeldung (bereits übersetzt) */
  error?: string;
  /** Feldfehler: name -> übersetzte Meldung */
  fieldErrors?: Record<string, string>;
  /** Erfolgsmeldung (bereits übersetzt) */
  message?: string;
};

/** Beschriftung eines Feldes oder einer Feldgruppe (`as="legend"` in einem fieldset). */
export function FieldLabel({ as: Tag = "p", className, children, ...props }: { as?: "p" | "legend" | "span"; className?: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...props} className={clsx("field-label", className)}>
      {children}
    </Tag>
  );
}

export function FieldHint({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={clsx("field-hint", className)}>{children}</p>;
}

export function FieldError({ as: Tag = "p", className, children }: { as?: "p" | "span"; className?: string; children: ReactNode }) {
  return (
    <Tag role="alert" className={clsx("field-error", className)}>
      {children}
    </Tag>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden className="ml-0.5 text-danger-ink">*</span> : null}
      </label>
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

type WithInvalid = { invalid?: boolean };

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
 */
export function Input({ invalid, className, autoFocus, inputMode, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & WithInvalid & { ref?: Ref<HTMLInputElement> }) {
  const mode = inputMode ?? (props.type === "number" ? numberInputMode(props.step) : undefined);
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  return <input {...props} inputMode={mode} ref={setRef} aria-invalid={invalid || undefined} className={clsx("input", className)} />;
}

/** Suchfeld mit Lupe (für Listen und Filter). */
export function SearchInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <div className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input enterKeyHint="search" {...props} type="search" className="input pl-9" />
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
  return <input {...props} type="color" className={clsx("h-(--tap) w-14 cursor-pointer rounded-md border border-line-strong bg-surface p-1", className)} />;
}

/** Dateiauswahl. */
export function FileInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      {...props}
      type="file"
      className={clsx("block min-h-(--tap) w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-hover", className)}
    />
  );
}

export function Select({ invalid, className, children, autoFocus, ref, ...props }: SelectHTMLAttributes<HTMLSelectElement> & WithInvalid & { ref?: Ref<HTMLSelectElement> }) {
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  return (
    <select {...props} ref={setRef} aria-invalid={invalid || undefined} className={clsx("input", className)}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, autoFocus, ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & WithInvalid & { ref?: Ref<HTMLTextAreaElement> }) {
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  return <textarea {...props} ref={setRef} aria-invalid={invalid || undefined} className={clsx("input", className)} />;
}

/** Formular in einer Karte (Anlegen/Bearbeiten-Seiten): Felder untereinander, `className` für Breite o. Ä. */
export function FormCard({ className, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return <form {...props} className={clsx("card card-pad flex flex-col gap-4", className)} />;
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-ink">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm text-success-ink">
        {state.message}
      </p>
    );
  }
  return null;
}

/** Farbauswahl aus Vorschlägen plus freier Wahl. `name` ist das Formularfeld, `onChange` meldet jede Änderung. */
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
