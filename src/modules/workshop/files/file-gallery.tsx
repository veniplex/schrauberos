"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { useInlineAction } from "@/components/ui/inline-action";
import { Badge, TextLink } from "@/components/ui/layout";
import { PhotoGallery, type GalleryPhoto } from "@/components/ui/photo-gallery";
import { useI18n } from "@/i18n/client";
import { xhrUploader, type Uploader } from "@/lib/upload-queue";
import { archiveFile, updateFile } from "./actions";
import { CAPTION_MAX, FILE_CATEGORIES, FILE_MAX_BYTES, MAX_FILES_PER_OWNER, type FileOwnerType } from "./constants";

export type FileItem = {
  id: string;
  name: string;
  caption: string | null;
  category: string;
  isImage: boolean;
  /** Größe als Text („1,2 MB“) */
  sizeLabel: string;
  version: string;
  mayChange: boolean;
  uploadedByName: string;
  /** Zeitpunkt als Text */
  createdLabel: string;
};

/** Beschriftung ändern und Datei entfernen (nur mit Recht). Entfernen fragt zurück (`ConfirmSubmitButton`), die Datei bleibt nach dem Entfernen unverändert auf dem Datenträger. */
function FileActions({ file }: { file: FileItem }) {
  const { t } = useI18n();
  const [, dispatch, pending] = useInlineAction(updateFile);
  if (!file.mayChange) return null;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <form action={dispatch} className="flex gap-1.5">
        <input type="hidden" name="id" value={file.id} />
        <input type="hidden" name="version" value={file.version} />
        <input type="hidden" name="category" value={file.category} />
        <Input name="caption" defaultValue={file.caption ?? ""} maxLength={CAPTION_MAX} aria-label={t("files.caption")} placeholder={t("files.caption")} className="min-w-0 flex-1" />
        <Button type="submit" size="sm" disabled={pending}>
          {t("common.save")}
        </Button>
      </form>
      <form action={archiveFile}>
        <input type="hidden" name="id" value={file.id} />
        <ConfirmSubmitButton message={t("files.removeConfirm")} variant="ghost" size="sm" label={t("files.remove")} target={file.caption || file.name}>
          {t("files.remove")}
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}

/**
 * Fotos und Dokumente eines Fahrzeugs oder Auftrags: Mehrfach-Upload von Fotos mit Warteschlange (`PhotoGallery`: zwei gleichzeitig, Fortschritt, Wiederholen bei schlechter Verbindung – jede Datei trägt ihren
 * `Idempotency-Key`, die Route legt eine wiederholte Datei nicht noch einmal ab), Kamera am Handy, Vorschaubilder über die Auslieferungsroute `/api/files/<id>`, Beschriftung, Entfernen mit Rückfrage und
 * ein eigener Weg für PDF-Dokumente. Der Server prüft und bereinigt jede Datei noch einmal (Inhalt, Bildpunkte, Exif/GPS, Recht).
 */
export function FileGallery({ ownerType, ownerId, files, canUpload }: { ownerType: FileOwnerType; ownerId: string; files: FileItem[]; canUpload: boolean }) {
  const { t, td } = useI18n();
  const router = useRouter();
  const [category, setCategory] = useState("photo");
  const [caption, setCaption] = useState("");
  const settings = useRef({ category: "photo", caption: "" });

  const photoUploader = useMemo<Uploader>(
    () => (file, context) =>
      xhrUploader("/api/files", { fields: { ownerType, ownerId, category: settings.current.category, ...(settings.current.caption ? { caption: settings.current.caption } : {}) } })(file, context),
    [ownerType, ownerId],
  );
  const documentUploader = useMemo<Uploader>(() => xhrUploader("/api/files", { fields: { ownerType, ownerId, category: "document" } }), [ownerType, ownerId]);

  const images = files.filter((f) => f.isImage);
  const documents = files.filter((f) => !f.isImage);
  const byId = new Map(files.map((f) => [f.id, f]));
  const photos: GalleryPhoto[] = images.map((f) => ({ id: f.id, src: `/api/files/${f.id}`, name: f.caption || f.name }));
  const label = (f: FileItem) => td(`files.categories.${f.category}`, f.category);

  return (
    <div className="flex flex-col gap-5">
      {canUpload ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("files.category")} htmlFor="file-category">
            <Select
              id="file-category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                settings.current.category = event.target.value;
              }}
            >
              {FILE_CATEGORIES.filter((c) => c !== "document").map((c) => (
                <option key={c} value={c}>
                  {td(`files.categories.${c}`, c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("files.nextCaption")} htmlFor="file-caption" hint={t("files.nextCaptionHint")}>
            <Input
              id="file-caption"
              value={caption}
              maxLength={CAPTION_MAX}
              onChange={(event) => {
                setCaption(event.target.value);
                settings.current.caption = event.target.value.trim();
              }}
              autoComplete="off"
            />
          </Field>
        </div>
      ) : null}

      {canUpload ? (
        <PhotoGallery
          photos={photos}
          uploader={photoUploader}
          maxFiles={MAX_FILES_PER_OWNER}
          maxBytes={FILE_MAX_BYTES}
          onUploaded={() => router.refresh()}
          renderActions={(photo) => {
            const file = byId.get(photo.id);
            return file ? (
              <div className="flex w-full flex-col gap-1.5">
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  <Badge>{label(file)}</Badge>
                  {file.caption ? <span className="min-w-0 break-words text-ink">{file.caption}</span> : null}
                </p>
                <FileActions file={file} />
              </div>
            ) : null;
          }}
        />
      ) : photos.length > 0 ? (
        <PhotoGallery
          photos={photos}
          uploader={photoUploader}
          hideEmpty
          readOnly
          renderActions={(photo) => {
            const file = byId.get(photo.id);
            // ohne Recht zum Hochladen, aber mit Recht zum Ändern (z. B. Leitung mit „Dateien entfernen“): Beschriften und Entfernen bleiben möglich
            return file ? (
              <div className="flex w-full flex-col gap-1.5">
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  <Badge>{label(file)}</Badge>
                  {file.caption ? <span className="min-w-0 break-words text-ink">{file.caption}</span> : null}
                </p>
                <FileActions file={file} />
              </div>
            ) : null;
          }}
        />
      ) : (
        <p className="text-sm text-ink-muted">{t("files.empty")}</p>
      )}

      {documents.length > 0 ? (
        <ul aria-label={t("files.documents")} className="flex flex-col divide-y divide-line rounded-md border border-line text-sm">
          {documents.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <TextLink href={`/api/files/${f.id}`} external target="_blank" rel="noopener" className="break-all">
                  {f.caption || f.name}
                </TextLink>
                <p className="text-xs text-ink-muted">
                  {f.sizeLabel} · {f.uploadedByName} · {f.createdLabel}
                </p>
              </div>
              <FileActions file={f} />
            </li>
          ))}
        </ul>
      ) : null}

      {canUpload ? (
        <PhotoGallery
          photos={[]}
          uploader={documentUploader}
          variant="file"
          accept="application/pdf"
          acceptFile={(file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name)}
          addLabel={t("files.addDocument")}
          hideEmpty
          maxFiles={MAX_FILES_PER_OWNER}
          maxBytes={FILE_MAX_BYTES}
          onUploaded={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
