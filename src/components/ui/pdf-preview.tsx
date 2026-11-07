"use client";

import { Download, ExternalLink, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/client";
import { Button, LinkButton } from "./buttons";

/**
 * PDF zeigen – nie inline per `<object>`/`<embed>` (die CSP verbietet beides, und Handys zeigen PDF in der Seite schlecht), sondern mit drei Wegen: **Öffnen** (neuer Tab bzw. der Betrachter des Geräts),
 * **Teilen** (Teilen-Dialog des Geräts mit der Datei – WhatsApp, Mail, AirDrop; nur wo `navigator.share` Dateien annimmt) und **Herunterladen**. Am Rechner gibt es zusätzlich eine Vorschau im `<iframe>`.
 *
 * **Vorschau nur am Desktop und erst nach Klick:** Unter `lg` gibt es keine Vorschau, und auch am Desktop wird das Dokument erst geladen, wenn jemand „Vorschau anzeigen“ wählt – der Rahmen wird dann erst
 * eingehängt (nicht per `hidden` versteckt: ein versteckter Rahmen lädt trotzdem). Die PDF-Antwort trägt nur `frame-ancestors 'self'` (`lib/file-delivery.ts`), keine `sandbox` – der Betrachter des Browsers würde sonst
 * nichts anzeigen.
 *
 * **Teilen:** Die Datei wird mit `fetch` (gleiche Herkunft, mit der Sitzung) geholt und als `File` übergeben. Bricht die Person den Dialog ab, passiert nichts; scheitert es sonst, steht ein Hinweis da („Bitte herunterladen“).
 * **iOS als installierte App (Standalone):** „Öffnen“ ersetzt dort die App-Ansicht ohne Rückweg – am iPhone daher lieber Teilen oder Herunterladen (Hinweis in der Hilfe, Kapitel „Auf dem Handy installieren“).
 */
function canShareFiles(): boolean {
  try {
    return typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}
const subscribeNothing = () => () => {};

export function PdfPreview({
  src,
  title,
  fileName,
  labels,
  preview = true,
}: {
  /** Adresse der PDF-Auslieferung (Route mit Rechteprüfung); `?download=1` erzwingt den Download */
  src: string;
  title: string;
  /** Name für „Teilen“ (Standard: Titel) */
  fileName?: string;
  labels: { show: string; hide: string; mobile: string };
  /** ohne Vorschau am Rechner (nur die drei Wege) */
  preview?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Teilen gibt es erst im Browser; der Server rendert ohne den Knopf (kein Abweichen beim Hydrieren)
  const canShare = useSyncExternalStore(subscribeNothing, canShareFiles, () => false);
  const downloadHref = `${src}${src.includes("?") ? "&" : "?"}download=1`;

  async function share() {
    setSharing(true);
    setProblem(false);
    try {
      const response = await fetch(src, { credentials: "same-origin" });
      if (!response.ok) throw new Error("download");
      const name = /\.pdf$/i.test(fileName ?? title) ? (fileName ?? title) : `${fileName ?? title}.pdf`;
      const file = new File([await response.blob()], name, { type: "application/pdf" });
      await navigator.share({ files: [file], title });
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") setProblem(true); // „Abbrechen“ im Teilen-Dialog ist keine Störung
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="p-4">
      <div role="group" aria-label={t("ui.pdf.actions")} className="flex flex-wrap gap-2">
        <LinkButton external href={src} target="_blank" rel="noreferrer">
          <ExternalLink className="size-4" aria-hidden /> {t("ui.pdf.open")}
        </LinkButton>
        {canShare ? (
          <Button onClick={() => void share()} disabled={sharing} aria-busy={sharing || undefined}>
            <Share2 className="size-4" aria-hidden /> {t("ui.pdf.share")}
          </Button>
        ) : null}
        <LinkButton external href={downloadHref} download>
          <Download className="size-4" aria-hidden /> {t("ui.pdf.download")}
        </LinkButton>
      </div>
      <p role="status" className="mt-2 text-sm text-danger-ink">
        {problem ? t("ui.pdf.shareFailed") : ""}
      </p>
      {preview ? (
        <>
          <p className="mt-2 text-sm text-ink-muted lg:hidden">{labels.mobile}</p>
          <div className="mt-2 max-lg:hidden">
            <Button size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? labels.hide : labels.show}
            </Button>
            {open ? <iframe src={src} title={title} className="mt-3 h-[70vh] w-full rounded-md border border-line bg-surface" /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
