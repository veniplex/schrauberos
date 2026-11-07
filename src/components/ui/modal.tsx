"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Modal, dessen Zustand in der URL liegt: Die Server-Komponente rendert es nur, wenn z. B.
 * `?edit=<id>` gesetzt ist; Schließen navigiert zu `closeHref`. Funktioniert mit Zurück-Button & Deep-Links.
 *
 * Mit **ungespeicherten Eingaben** fragt Schließen (Escape, Klick daneben, Schließen-Knopf) „Änderungen verwerfen?“, statt sie stumm zu verlieren.
 * Unter `sm` liegt es als Blatt am unteren Bildschirmrand (siehe `dialog.modal` in globals.css); die Seite dahinter lässt sich nicht scrollen.
 */
export function UrlModal({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { t } = useI18n();
  const dirty = useRef(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const requestClose = () => {
    if (dirty.current) setConfirming(true);
    else router.push(closeHref);
  };

  return (
    <>
      <dialog
        ref={ref}
        className="modal"
        aria-labelledby="modal-title"
        onCancel={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onClick={(e) => {
          if (e.target === ref.current) requestClose();
        }}
        onInput={() => {
          dirty.current = true;
        }}
        onChange={() => {
          dirty.current = true;
        }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id="modal-title" className="text-base font-semibold">
            {title}
          </h2>
          <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={requestClose}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </dialog>
      <ConfirmDialog
        open={confirming}
        title={t("common.discardTitle")}
        description={t("common.discardText")}
        confirmLabel={t("common.discard")}
        cancelLabel={t("common.keepEditing")}
        onCancel={() => setConfirming(false)}
        onConfirm={() => router.push(closeHref)}
      />
    </>
  );
}
