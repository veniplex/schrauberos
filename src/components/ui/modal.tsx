"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/client";

/**
 * Modal, dessen Zustand in der URL liegt: Die Server-Komponente rendert es nur, wenn z. B.
 * `?edit=<id>` gesetzt ist; Schließen navigiert zu `closeHref`. Funktioniert mit Zurück-Button & Deep-Links.
 */
export function UrlModal({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        router.push(closeHref);
      }}
      onClick={(e) => {
        if (e.target === ref.current) router.push(closeHref);
      }}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="modal-title" className="text-base font-semibold">
          {title}
        </h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t("common.close")} onClick={() => router.push(closeHref)}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
