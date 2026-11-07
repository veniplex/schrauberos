"use client";

import { useState } from "react";
import { Button } from "./buttons";

/**
 * Vorschau eines PDF im `<iframe>` (Content-Security-Policy: `frame-src 'self'`, `object-src 'none'` verbietet `<object>`/`<embed>`).
 *
 * **Nur am Desktop und erst nach Klick:** Unter `lg` gibt es keine Vorschau (Handys zeigen PDF schlecht, laden aber die Datei), und auch am Desktop wird das Dokument erst
 * geladen, wenn jemand „Vorschau anzeigen“ wählt – der Rahmen wird dann erst eingehängt (nicht per `hidden` versteckt: ein versteckter Rahmen lädt trotzdem).
 * Die PDF-Antwort trägt nur `frame-ancestors 'self'` (`lib/file-delivery.ts`), keine `sandbox` – der Betrachter des Browsers würde sonst nichts anzeigen.
 */
export function PdfPreview({ src, title, labels }: { src: string; title: string; labels: { show: string; hide: string; mobile: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-4">
      <p className="text-sm text-ink-muted lg:hidden">{labels.mobile}</p>
      <div className="max-lg:hidden">
        <Button size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? labels.hide : labels.show}
        </Button>
        {open ? <iframe src={src} title={title} className="mt-3 h-[70vh] w-full rounded-md border border-line bg-surface" /> : null}
      </div>
    </div>
  );
}
