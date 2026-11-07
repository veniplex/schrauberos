"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { useRef, useState, type ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Schalter (ein/aus), der ein Formular absendet: `role="switch"` mit `aria-checked`. Das umgebende Formular trägt den **neuen** Zustand (versteckte Felder), der Klick sendet es ab.
 * Mit `confirm` fragt das **Ausschalten** erst nach (`ConfirmDialog`: Titel nennt die Aktion, `message` erklärt die Folgen); Einschalten geht sofort. Während des Absendens ist er gesperrt.
 */
export function SubmitSwitch({
  checked,
  label,
  confirm,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "role" | "aria-checked" | "aria-label"> & {
  checked: boolean;
  /** Zugänglicher Name („Funktion Termine“) */
  label: string;
  confirm?: { title: string; message: string; confirmLabel: string };
}) {
  const { pending } = useFormStatus();
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        {...props}
        ref={button}
        type="submit"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-busy={pending || undefined}
        disabled={pending || props.disabled}
        onClick={(event) => {
          if (checked && confirm) {
            event.preventDefault();
            setAsking(true);
          }
        }}
        className={clsx(
          "group relative inline-flex h-(--tap) min-w-(--tap) shrink-0 cursor-pointer items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <span
          aria-hidden
          className={clsx(
            "relative inline-flex h-6 w-11 items-center rounded-full border border-line-strong transition-colors group-hover:border-ink-muted",
            checked ? "bg-accent" : "bg-surface-2",
          )}
        >
          <span className={clsx("grid size-5 place-items-center rounded-full bg-surface shadow-sm transition-transform", checked ? "translate-x-5" : "translate-x-0.5")}>
            {pending ? <Loader2 className="size-3 animate-spin text-ink-muted" /> : null}
          </span>
        </span>
      </button>
      {confirm ? (
        <ConfirmDialog
          open={asking}
          title={confirm.title}
          description={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            button.current?.form?.requestSubmit(button.current);
          }}
        />
      ) : null}
    </>
  );
}
