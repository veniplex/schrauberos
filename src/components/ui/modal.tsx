"use client";

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";
import { ConfirmDialog } from "./confirm-dialog";
import { removeDraft } from "./form-draft";
import { DraftScopeContext } from "./form-context";

/**
 * Modal, dessen Zustand in der URL liegt: Die Server-Komponente rendert es nur, wenn z. B.
 * `?edit=<id>` gesetzt ist; Schließen navigiert zu `closeHref`. Funktioniert mit Zurück-Button & Deep-Links.
 *
 * Mit **ungespeicherten Eingaben** fragt Schließen (Escape, Klick daneben, Schließen-Knopf) „Änderungen verwerfen?“, statt sie stumm zu verlieren; „Verwerfen“ löscht auch die Entwürfe
 * der Formulare darin (sonst käme die verworfene Eingabe beim nächsten Öffnen zurück). Beim Schließen geht der Fokus an das Element zurück, das das Fenster geöffnet hat.
 * Unter `sm` liegt es als Blatt am unteren Bildschirmrand (siehe `dialog.modal` in globals.css); die Seite dahinter lässt sich nicht scrollen.
 */
export function UrlModal({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { t } = useI18n();
  const dirty = useRef(false);
  const downOnBackdrop = useRef(false);
  const scope = useContext(DraftScopeContext);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    // Nach dem Schließen ist der Auslöser oft ein neuer Knoten (die Seite hat sich neu aufgebaut): dann über Kennung oder Ziel wiederfinden
    const openerId = opener?.id ?? "";
    const openerHref = opener?.getAttribute("href") ?? "";
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      // beim Schließen (die Seite hängt das Fenster aus) zurück zum Auslöser; gibt es ihn nicht mehr, zur Hauptüberschrift (nie auf <body>)
      if (opener?.isConnected) {
        opener.focus();
        return;
      }
      const again = (openerId ? document.getElementById(openerId) : null) ?? (openerHref ? Array.from(document.querySelectorAll<HTMLElement>("a[href]")).find((a) => a.getAttribute("href") === openerHref && !a.closest("dialog")) : null);
      if (again) {
        again.focus();
        return;
      }
      if (opener) {
        const heading = document.querySelector<HTMLElement>("main h1");
        if (heading) {
          if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
        }
      }
    };
  }, []);

  const discard = () => {
    for (const form of Array.from(ref.current?.querySelectorAll<HTMLFormElement>("form[data-draft-key]") ?? [])) removeDraft(scope, form.dataset.draftKey ?? "");
    router.push(closeHref);
  };

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
        // Klick auf den Hintergrund schließt nur, wenn auch das Drücken dort begann (Text markieren und außerhalb loslassen ist kein „Klick daneben“)
        onMouseDown={(e) => {
          downOnBackdrop.current = e.target === ref.current;
        }}
        onClick={(e) => {
          if (e.target === ref.current && downOnBackdrop.current) requestClose();
          downOnBackdrop.current = false;
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
        onConfirm={discard}
      />
    </>
  );
}
