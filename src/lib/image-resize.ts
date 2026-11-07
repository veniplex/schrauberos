/**
 * Fotos vor dem Hochladen verkleinern (Foto-Baustein `FileInput variant="photo"`): Handyfotos sind 4–8 MB groß, für Belege und Dokumentation genügen 1600 px.
 *
 * Die Entscheidung (was wird angefasst, was bleibt, welches Format) ist reine Logik und hier ohne Browser testbar; Dekodieren und Kodieren (`createImageBitmap`,
 * Canvas) stecken hinter `ImageEngine` und sind austauschbar (`browserImageEngine` ist die echte).
 *
 *  - Nur Rasterbilder: PDF, XML, SVG … bleiben unverändert.
 *  - Die Drehung aus den EXIF-Daten wird beim Dekodieren angewandt (`imageOrientation: "from-image"`); das Ergebnis ist ein JPEG ohne EXIF.
 *  - Bilder mit Transparenz (PNG, WebP) werden **nie** zu JPEG (der Hintergrund würde schwarz); zu große werden als PNG verkleinert.
 *  - GIF und animiertes WebP bleiben unverändert (ein Einzelbild würde die Animation und die Transparenz zerstören).
 *  - Was ohnehin klein genug ist, bleibt das Original: Ein Bild bis 1600 px wird nicht neu kodiert (Qualitätsverlust ohne Nutzen), und das Ergebnis ersetzt das Original
 *    nur, wenn es kleiner ist.
 *  - HEIC/HEIF, das der Browser nicht dekodieren kann (Chrome unter Android): `ImageError("heic")` – die Oberfläche erklärt, wie es als JPEG geht.
 *    Jedes andere Bild, das sich nicht dekodieren lässt, bleibt unverändert (der Server prüft die Datei ohnehin).
 */

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.8;

/** Ein dekodiertes Bild (Browser: `ImageBitmap`). `close` gibt den Speicher frei. */
export type Raster = { width: number; height: number; close?(): void };

export type OutputType = "image/jpeg" | "image/png";

export type ImageEngine = {
  /** Datei dekodieren; die Drehung aus den EXIF-Daten ist angewandt. Wirft, wenn der Browser das Format nicht kann. */
  decode(file: Blob): Promise<Raster>;
  /** Auf `width` × `height` skalieren und als `type` kodieren (`quality` gilt für JPEG). */
  encode(raster: Raster, width: number, height: number, type: OutputType, quality: number): Promise<Blob>;
};

export type ImageErrorCode = "heic" | "encode";

export class ImageError extends Error {
  constructor(readonly code: ImageErrorCode) {
    super(code);
    this.name = "ImageError";
  }
}

export type PreparedImage = {
  file: File;
  /** `resized`: neu kodiert · `unchanged`: Original beibehalten */
  status: "resized" | "unchanged";
};

type Kind = "jpeg" | "png" | "webp" | "gif" | "heic" | "other";

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** Bildart an den ersten Bytes erkennen (der Dateityp des Browsers ist unter Android oft leer oder falsch). */
export function sniffImage(head: Uint8Array): Kind {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return "png";
  if (head.length >= 6 && /^GIF8[79]a$/.test(ascii(head, 0, 6))) return "gif";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "webp";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(head, 8, 12))) return "heic";
  return "other";
}

/** PNG: Farbtyp 4 (Grau + Alpha) und 6 (RGBA) haben Alpha; Paletten- und Graubilder können es über einen `tRNS`-Block haben. */
function pngHasAlpha(head: Uint8Array): boolean {
  if (head.length < 26) return false;
  const colorType = head[25];
  if (colorType === 4 || colorType === 6) return true;
  // `tRNS` steht zwischen `IHDR` und den Bilddaten; im gelesenen Anfang suchen
  return ascii(head, 0, head.length).includes("tRNS");
}

/** WebP: `VP8X` trägt die Merkmale (Alpha 0x10, Animation 0x02), `VP8L` ein Alpha-Bit im Kopf, `VP8 ` (verlustbehaftet ohne Erweiterung) hat nie Alpha. */
function webpFlags(head: Uint8Array): { alpha: boolean; animated: boolean } {
  const chunk = ascii(head, 12, 16);
  if (chunk === "VP8X" && head.length > 20) return { alpha: (head[20] & 0x10) !== 0, animated: (head[20] & 0x02) !== 0 };
  if (chunk === "VP8L" && head.length >= 25 && head[20] === 0x2f) return { alpha: ((head[24] >> 4) & 1) === 1, animated: false };
  return { alpha: false, animated: false };
}

function kindOfType(type: string): Kind {
  const lower = type.toLowerCase();
  if (lower === "image/jpeg" || lower === "image/jpg") return "jpeg";
  if (lower === "image/png") return "png";
  if (lower === "image/webp") return "webp";
  if (lower === "image/gif") return "gif";
  if (lower === "image/heic" || lower === "image/heif") return "heic";
  return "other";
}

const HEAD_BYTES = 4096;

async function readHead(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
}

function renamed(name: string, extension: string) {
  const base = name.replace(/\.[^./\\]+$/, "") || "foto";
  return `${base}.${extension}`;
}

/**
 * Bereitet eine gewählte Datei für den Upload vor. Gibt die Datei zurück, die gesendet werden soll (Original oder verkleinerte Fassung).
 * Wirft nur `ImageError`; jede andere Störung führt zum Original.
 */
export async function prepareImage(file: File, engine: ImageEngine, options: { maxEdge?: number; quality?: number; maxBytes?: number } = {}): Promise<PreparedImage> {
  const maxEdge = options.maxEdge ?? PHOTO_MAX_EDGE;
  const quality = options.quality ?? PHOTO_QUALITY;
  const unchanged: PreparedImage = { file, status: "unchanged" };

  const head = await readHead(file);
  const sniffed = sniffImage(head);
  const named = /\.(heic|heif)$/i.test(file.name) ? "heic" : "other";
  // Der Inhalt zählt, der angegebene Typ nur, wenn der Inhalt nichts verrät (z. B. HEIC mit leerem Typ)
  const kind: Kind = sniffed !== "other" ? sniffed : kindOfType(file.type) !== "other" ? kindOfType(file.type) : named;
  if (kind === "other") return unchanged; // PDF, XML, SVG …
  if (kind === "gif") return unchanged;

  let alpha = false;
  if (kind === "png") alpha = pngHasAlpha(head);
  if (kind === "webp") {
    const flags = webpFlags(head);
    if (flags.animated) return unchanged;
    alpha = flags.alpha;
  }

  let raster: Raster;
  try {
    raster = await engine.decode(file);
  } catch {
    if (kind === "heic") throw new ImageError("heic");
    return unchanged;
  }

  try {
    const longest = Math.max(raster.width, raster.height);
    if (!(longest > 0)) return unchanged;
    const needsScaling = longest > maxEdge;
    // Klein genug in Pixeln und Bytes: das Original bleibt (kein Neukodieren ohne Nutzen). HEIC muss immer umgewandelt werden (der Server nimmt es nicht an).
    if (kind !== "heic" && !needsScaling && (options.maxBytes === undefined || file.size <= options.maxBytes)) return unchanged;

    const ratio = needsScaling ? maxEdge / longest : 1;
    const width = Math.max(1, Math.round(raster.width * ratio));
    const height = Math.max(1, Math.round(raster.height * ratio));
    const type: OutputType = alpha ? "image/png" : "image/jpeg";

    let blob: Blob;
    try {
      blob = await engine.encode(raster, width, height, type, quality);
    } catch {
      if (kind === "heic") throw new ImageError("heic");
      return unchanged;
    }
    if (!blob || blob.size === 0 || blob.type !== type) {
      // Der Browser hat das gewünschte Format nicht geliefert (z. B. ältere WebKit-Fassungen für JPEG aus OffscreenCanvas): Original behalten
      if (kind === "heic") throw new ImageError("heic");
      return unchanged;
    }
    // Das Original nur ersetzen, wenn die neue Fassung kleiner ist (ein stark komprimiertes Bild wird beim Neukodieren manchmal größer)
    if (kind !== "heic" && blob.size >= file.size) return unchanged;
    const out = new File([blob], renamed(file.name, type === "image/png" ? "png" : "jpg"), { type, lastModified: file.lastModified });
    return { file: out, status: "resized" };
  } finally {
    raster.close?.();
  }
}

/* ───────────── Browser-Anbindung ───────────── */

/** Die echte Anbindung: `createImageBitmap` und Canvas. Nur im Browser aufrufen. */
export const browserImageEngine: ImageEngine = {
  async decode(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      // Ältere Browser kennen die Optionen nicht (dort ist „von der Datei“ ohnehin die Vorgabe)
      if (error instanceof TypeError) return await createImageBitmap(file);
      throw error;
    }
  },
  async encode(raster, width, height, type, quality) {
    const source = raster as ImageBitmap;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(source, 0, 0, width, height);
        return await canvas.convertToBlob({ type, quality });
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(source, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), type, quality));
  },
};

/**
 * Schreibt `files` in das Dateifeld zurück (`DataTransfer`). Nötig bei Formularen mit Server Action: Der Browser sendet, was im Feld steht – ohne Rückschreiben das Original.
 * Gibt false zurück, wenn der Browser das Setzen nicht erlaubt (sehr alte Fassungen); dann bleibt das Feld unverändert.
 */
export function setInputFiles(input: HTMLInputElement, files: File[]): boolean {
  try {
    const DataTransferType = input.ownerDocument.defaultView?.DataTransfer ?? globalThis.DataTransfer;
    const transfer = new DataTransferType();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    return Array.from(input.files ?? []).length === files.length;
  } catch {
    return false;
  }
}
