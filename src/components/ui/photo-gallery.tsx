"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Ban, Check, Loader2, RotateCw, TriangleAlert, X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import type { ImageEngine } from "@/lib/image-resize";
import { createUploadQueue, type UploadItem, type Uploader } from "@/lib/upload-queue";
import { Button } from "./buttons";
import { FileInput } from "./form-fields";

/**
 * Foto-Galerie mit Mehrfach-Upload (Fotos an Auftrag und Fahrzeug): baut auf dem Foto-Baustein (`FileInput variant="photo"`, verkleinert jedes Foto vor dem Hochladen auf höchstens 1600 px, bei Touch mit
 * „Foto aufnehmen“) und der Warteschlange `lib/upload-queue.ts` auf.
 *
 *  - Mehrere Fotos auf einmal; **höchstens zwei laufen gleichzeitig**, der Rest wartet. Jede Datei hat ihren **Fortschrittsbalken** und ihren Zustand (wartet, wird hochgeladen, hochgeladen, fehlgeschlagen,
 *    abgebrochen) – als Text, nicht nur als Farbe.
 *  - **Wiederholen bei Fehler** je Datei (kein Foto geht verloren, weil das Netz in der Halle schwach war), **Abbrechen** je Datei, „Aus der Liste entfernen“ für Beendetes.
 *  - Ein HEIC-Foto, das der Browser nicht kennt, oder ein zu großes Foto hält die übrigen der Auswahl nicht auf (Hinweis unter dem Feld).
 *  - Schon gespeicherte Fotos (`photos`) stehen davor; `renderActions` hängt Aktionen daran (Löschen mit Rückfrage – das gehört der Funktion, nicht dem Baustein). `onUploaded` meldet jede fertige Datei
 *    einmal (typisch: `router.refresh()`, damit die Seite die neue Liste vom Server holt).
 *  - Der Server prüft jede Datei noch einmal (Inhalt, Pixelgrenzen, EXIF/GPS wird serverseitig entfernt, Recht); der Baustein glaubt sich selbst nichts.
 */
export type GalleryPhoto = { id: string; src: string; thumbSrc?: string; name: string };

function Thumb({ file, className }: { file: Blob; className?: string }) {
  // Vorschau aus der Datei im Speicher des Browsers (CSP: `img-src blob:`); die Adresse wird beim Entfernen des Bildes freigegeben
  const attach = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      try {
        const url = URL.createObjectURL(file);
        img.src = url;
        return () => URL.revokeObjectURL(url);
      } catch {
        return undefined;
      }
    },
    [file],
  );
  // eslint-disable-next-line @next/next/no-img-element -- Vorschau einer lokalen Datei
  return <img ref={attach} alt="" className={clsx("size-14 shrink-0 rounded-md border border-line bg-surface-2 object-cover", className)} />;
}

export function PhotoGallery({
  photos = [],
  uploader,
  maxFiles = 30,
  maxBytes = 2 * 1024 * 1024,
  onUploaded,
  renderActions,
  imageEngine,
  accept = "image/*",
  acceptFile,
  variant = "photo",
  addLabel,
  hideEmpty = false,
  readOnly = false,
  className,
}: {
  photos?: readonly GalleryPhoto[];
  uploader: Uploader;
  maxFiles?: number;
  maxBytes?: number;
  onUploaded?: (item: UploadItem) => void;
  renderActions?: (photo: GalleryPhoto) => ReactNode;
  /** nur für Tests */
  imageEngine?: ImageEngine;
  /** Auswahl des Dateidialogs (Standard Bilder); mit `variant="file"` lassen sich andere Dateien (PDF) auf demselben Weg hochladen */
  accept?: string;
  /** Welche Dateien die Warteschlange annimmt (Standard: Bilder) */
  acceptFile?: (file: File) => boolean;
  /** `photo`: Fotos werden vor dem Hochladen verkleinert (Standard); `file`: unverändert */
  variant?: "photo" | "file";
  /** Beschriftung des Auswahlfelds (Standard „Fotos hinzufügen“) */
  addLabel?: string;
  /** Den Hinweis „Noch keine Fotos“ weglassen (die Liste steht an anderer Stelle) */
  hideEmpty?: boolean;
  /** Nur ansehen: kein Auswahlfeld, keine Warteschlange (wer nicht hochladen darf) */
  readOnly?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [queue] = useState(() => createUploadQueue({ uploader, maxBytes, concurrency: 2, accept: acceptFile ?? ((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) }));
  const items = useSyncExternalStore(queue.subscribe, queue.items, queue.items);
  const [notice, setNotice] = useState<string | null>(null);

  const reported = useRef(new Set<string>());
  const callback = useRef(onUploaded);
  useEffect(() => {
    callback.current = onUploaded;
  });
  useEffect(() => {
    for (const item of items) {
      if (item.status === "done" && !reported.current.has(item.id)) {
        reported.current.add(item.id);
        callback.current?.(item);
      }
    }
  }, [items]);

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // dieselbe Datei lässt sich danach noch einmal wählen
    if (files.length === 0) return;
    // fertige Uploads stehen (nach `onUploaded` → neue Liste vom Server) schon in `photos`: nicht doppelt zählen
    const room = Math.max(0, maxFiles - photos.length - queue.items().filter((item) => item.status !== "done").length);
    const { rejected } = queue.add(files.slice(0, room));
    setNotice(files.length > room ? t("ui.gallery.tooMany", { max: maxFiles }) : rejected.some((r) => r.problem === "duplicate") ? t("ui.gallery.duplicate") : null);
  }

  const done = items.filter((item) => item.status === "done").length;
  const text = (item: UploadItem) =>
    item.status === "queued"
      ? t("ui.gallery.queued")
      : item.status === "uploading"
        ? t("ui.gallery.uploading", { percent: Math.round(item.progress * 100) })
        : item.status === "done"
          ? t("ui.gallery.done")
          : item.status === "cancelled"
            ? t("ui.gallery.cancelled")
            : `${t("ui.gallery.failed")}: ${errorText(item.error)}`;
  const errorText = (code?: string) => (code && ERROR_KEYS.has(code) ? t(`ui.gallery.errors.${code as ErrorCode}`) : t("ui.gallery.errors.failed"));

  return (
    <div className={clsx("flex flex-col gap-4", className)}>
      {readOnly ? null : (
        <div>
          <FileInput variant={variant} multiple accept={accept} maxBytes={maxBytes} imageEngine={imageEngine} aria-label={addLabel ?? t("ui.gallery.add")} onChange={onFiles} />
          {notice ? (
            <p role="alert" className="field-error">
              {notice}
            </p>
          ) : null}
        </div>
      )}

      {!hideEmpty && photos.length === 0 && items.length === 0 ? <p className="text-sm text-ink-muted">{t("ui.gallery.empty")}</p> : null}

      {photos.length > 0 ? (
        <ul aria-label={t("ui.gallery.list")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.id} className="flex flex-col gap-1.5">
              <a href={photo.src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-line bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- geschützte Datei aus der Anwendung */}
                <img src={photo.thumbSrc ?? photo.src} alt={photo.name} loading="lazy" className="aspect-square w-full object-cover" />
              </a>
              {renderActions ? <div className="flex flex-wrap gap-1.5">{renderActions(photo)}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line p-2">
                <Thumb file={item.file} />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium">{item.file.name}</p>
                  <div
                    role="progressbar"
                    aria-label={t("ui.gallery.progress", { name: item.file.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"
                  >
                    <div className={clsx("h-full rounded-full transition-[width]", item.status === "error" ? "bg-danger-ink" : item.status === "cancelled" ? "bg-ink-muted" : "bg-accent")} style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </div>
                  <p className={clsx("mt-1 flex items-center gap-1.5 text-xs", item.status === "error" ? "text-danger-ink" : "text-ink-muted")}>
                    {item.status === "uploading" || item.status === "queued" ? <Loader2 className={clsx("size-3.5", item.status === "uploading" && "animate-spin")} aria-hidden /> : null}
                    {item.status === "done" ? <Check className="size-3.5 text-success-ink" aria-hidden /> : null}
                    {item.status === "error" ? <TriangleAlert className="size-3.5" aria-hidden /> : null}
                    {item.status === "cancelled" ? <Ban className="size-3.5" aria-hidden /> : null}
                    {text(item)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {item.status === "error" || item.status === "cancelled" ? (
                    <Button size="sm" onClick={() => queue.retry(item.id)} aria-label={t("ui.gallery.retryFile", { name: item.file.name })}>
                      <RotateCw className="size-3.5" aria-hidden /> {t("ui.gallery.retry")}
                    </Button>
                  ) : null}
                  {item.status === "queued" || item.status === "uploading" ? (
                    <Button size="sm" onClick={() => queue.cancel(item.id)} aria-label={t("ui.gallery.cancelFile", { name: item.file.name })}>
                      <X className="size-3.5" aria-hidden /> {t("ui.gallery.cancel")}
                    </Button>
                  ) : (
                    <Button size="icon-sm" variant="ghost" onClick={() => queue.remove(item.id)} aria-label={t("ui.gallery.dismissFile", { name: item.file.name })}>
                      <X className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p role="status" className="sr-only">
            {t("ui.gallery.summary", { done, total: items.length })}
          </p>
        </>
      ) : null}
    </div>
  );
}

const ERROR_KEYS = new Set(["network", "timeout", "http_401", "http_403", "http_413", "http_415", "http_429", "http_503", "failed"]);
type ErrorCode = "network" | "timeout" | "http_401" | "http_403" | "http_413" | "http_415" | "http_429" | "http_503" | "failed";
