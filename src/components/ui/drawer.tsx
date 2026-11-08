"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "./buttons";

/**
 * Seitenfach (Navigation auf Handy und Tablet bis 1023 px) als natives modales `<dialog>`: Der Browser stellt Fokusfalle, Escape, inaktiven Hintergrund und – beim Schließen –
 * die **Rückgabe des Fokus an den Knopf** bereit, der es geöffnet hat – **außer in Safari/WebKit**: Dort bekommt ein Knopf beim Anklicken keinen Fokus, es gibt nichts zurückzugeben
 * (Tastaturnutzer landen am Seitenanfang). Deshalb setzt `returnFocusTo` den Fokus nach dem Schließen ausdrücklich auf den Auslöser. Dazu: Schließen-Knopf, Klick auf den Hintergrund schließt, die Seite dahinter scrollt nicht
 * (`html:has(dialog[open])`), Höhe `100dvh`, Safe-Area (siehe `dialog.drawer` in globals.css).
 */
export function Drawer({
  open,
  onClose,
  label,
  closeLabel,
  returnFocusTo,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  closeLabel: string;
  /** Auslöser, der nach dem Schließen den Fokus bekommt (der Browser tut es nicht überall von selbst) */
  returnFocusTo?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={label}
      onClose={() => returnFocusTo?.current?.focus()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex justify-end px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <Button variant="ghost" size="icon" aria-label={closeLabel} onClick={onClose}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
