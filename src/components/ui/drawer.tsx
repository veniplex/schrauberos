"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./buttons";

/**
 * Seitenfach (Navigation auf Handy und Tablet bis 1023 px) als natives modales `<dialog>`: Der Browser stellt Fokusfalle, Escape, inaktiven Hintergrund und – beim Schließen –
 * die **Rückgabe des Fokus an den Knopf** bereit, der es geöffnet hat. Dazu: Schließen-Knopf, Klick auf den Hintergrund schließt, die Seite dahinter scrollt nicht
 * (`html:has(dialog[open])`), Höhe `100dvh`, Safe-Area (siehe `dialog.drawer` in globals.css).
 */
export function Drawer({ open, onClose, label, closeLabel, children }: { open: boolean; onClose: () => void; label: string; closeLabel: string; children: ReactNode }) {
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
