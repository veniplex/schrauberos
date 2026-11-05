import clsx from "clsx";
import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

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
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

type WithInvalid = { invalid?: boolean };

export function Input({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & WithInvalid) {
  return <input {...props} aria-invalid={invalid || undefined} className={clsx("input", className)} />;
}

export function Select({ invalid, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & WithInvalid) {
  return (
    <select {...props} aria-invalid={invalid || undefined} className={clsx("input", className)}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & WithInvalid) {
  return <textarea {...props} aria-invalid={invalid || undefined} className={clsx("input", className)} />;
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
