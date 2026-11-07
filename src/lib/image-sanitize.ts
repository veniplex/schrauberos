import { crc32, inspectPng } from "./png";

/**
 * Bereinigung hochgeladener Fotos **ohne native Bibliothek** (reine Segmentarbeit an den Bytes, nichts wird dekodiert): Maße aus dem Dateikopf prüfen (Dekompressionsbomben), Metadaten entfernen,
 * die Drehung erhalten. Läuft auf dem Server für **jeden** Upload – Oberfläche wie API (der Browser verkleinert Fotos zwar, aber nur größere, und ein API-Client gar nicht).
 *
 *  - **JPEG:** Behalten werden Struktur und Bilddaten (SOFn, DQT, DHT, DRI, SOS samt Daten), das JFIF-Kopfstück (ohne eingebettetes Vorschaubild) und – für die richtige Farbe – das Adobe-Segment (APP14)
 *    und das ICC-Profil (APP2 „ICC_PROFILE“). Entfernt werden **APP1** (Exif mit GPS, Kamera, Zeit; XMP), APP13 (IPTC/Photoshop), alle übrigen APPn (auch MPF, das weitere Bilder tragen kann),
 *    Kommentare und **alles hinter EOI** (angehängte Nutzlast).
 *  - **PNG:** Behalten werden IHDR, PLTE, IDAT, IEND und die farbbestimmenden Teile (tRNS, gAMA, cHRM, sRGB, iCCP, sBIT, bKGD, pHYs, hIST, sPLT); entfernt werden tEXt/zTXt/iTXt (Texte, auch XMP), **eXIf**, tIME,
 *    Animationsteile (acTL/fcTL/fdAT: es bleibt das erste Bild) und alles Unbekannte.
 *  - **Drehung bleibt:** Die Exif-Ausrichtung (1–8) wird vor dem Entfernen gelesen; ist sie nicht 1, schreibt die Bereinigung einen **minimalen Exif-Block nur mit der Ausrichtung** zurück (JPEG: APP1,
 *    PNG: eXIf). So zeigt jede Ansicht das Foto richtig herum, ohne dass Ort oder Kamera mitreisen.
 *  - HEIC/HEIF, SVG, GIF und WebP nimmt der Upload nicht an (sie lassen sich ohne Dekoder nicht sicher bereinigen).
 * Der Aufrufer prüft vorher den Inhalt (`checkUpload`) und die Dateigröße.
 */

export const IMAGE_LIMITS = {
  /** Obergrenze der Bildpunkte (Breite × Höhe): bestimmt den Speicher eines späteren Dekoders (50 Megapixel) */
  maxPixels: 50_000_000,
  /** längste Kante */
  maxSide: 20_000,
} as const;

export type ImageLimits = { maxPixels: number; maxSide: number };
export type SanitizedImage = { ok: true; kind: "jpeg" | "png"; bytes: Buffer; width: number; height: number; orientation: number; removedBytes: number };
export type SanitizeFailure = { ok: false; reason: "format" | "corrupt" | "size" };

const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

/** Liest die Ausrichtung (1–8) aus einem TIFF-Block (Anfang: „II“/„MM“); 1, wenn sie fehlt oder der Block unlesbar ist. Alle Zugriffe sind begrenzt. */
export function orientationOfTiff(tiff: Uint8Array): number {
  if (tiff.length < 14) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const read16 = (at: number) => (little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1]);
  const read32 = (at: number) => (little ? (tiff[at] | (tiff[at + 1] << 8) | (tiff[at + 2] << 16) | (tiff[at + 3] << 24)) >>> 0 : ((tiff[at] << 24) | (tiff[at + 1] << 16) | (tiff[at + 2] << 8) | tiff[at + 3]) >>> 0);
  if (read16(2) !== 42) return 1;
  const ifd = read32(4);
  if (ifd < 8 || ifd + 2 > tiff.length) return 1;
  const count = Math.min(read16(ifd), 256);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Der kleinste TIFF-Block mit nur der Ausrichtung (Big Endian, 26 Bytes). */
export function minimalTiff(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8); // ein Eintrag
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // Anzahl
  tiff.writeUInt16BE(orientation, 18);
  // 20–21 Füllbytes, 22–25: kein weiteres IFD
  return tiff;
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function sanitizeJpeg(b: Uint8Array, limits: ImageLimits): SanitizedImage | SanitizeFailure {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return { ok: false, reason: "corrupt" };
  let at = 2;
  let jfif: Buffer | null = null;
  const rest: Buffer[] = [];
  let orientation = 1;
  let sawExif = false;
  let width = 0;
  let height = 0;
  let sawSos = false;
  let sawEoi = false;
  let end = b.length;
  while (at < b.length) {
    if (b[at] !== 0xff) return { ok: false, reason: "corrupt" };
    while (at + 1 < b.length && b[at + 1] === 0xff) at++; // Füllbytes
    if (at + 1 >= b.length) return { ok: false, reason: "corrupt" };
    const marker = b[at + 1];
    const markerAt = at;
    at += 2;
    if (marker === 0xd9) {
      sawEoi = true;
      end = at;
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x00) return { ok: false, reason: "corrupt" };
    if (marker === 0x01) continue; // TEM
    if (at + 2 > b.length) return { ok: false, reason: "corrupt" };
    const length = u16(b, at);
    if (length < 2 || at + length > b.length) return { ok: false, reason: "corrupt" };
    const data = b.subarray(at + 2, at + length);
    const segment = Buffer.from(b.subarray(markerAt, at + length));
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (data.length < 6 || width !== 0) return { ok: false, reason: "corrupt" };
      height = u16(data, 1);
      width = u16(data, 3);
      if (width < 1 || height < 1 || width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) return { ok: false, reason: "size" };
      rest.push(segment);
    } else if (marker === 0xe0) {
      // nur die Kopfangaben von JFIF, ohne eingebettetes Vorschaubild
      if (ascii(data, 0, 5) === "JFIF\0" && data.length >= 14 && !jfif) jfif = jpegSegment(0xe0, Buffer.concat([Buffer.from(data.subarray(0, 12)), Buffer.from([0, 0])]));
    } else if (marker === 0xe1) {
      if (!sawExif && ascii(data, 0, 6) === "Exif\0\0") {
        sawExif = true;
        orientation = orientationOfTiff(data.subarray(6));
      }
    } else if (marker === 0xe2) {
      if (ascii(data, 0, 12) === "ICC_PROFILE\0") rest.push(segment);
    } else if (marker === 0xee) {
      if (ascii(data, 0, 5) === "Adobe") rest.push(segment);
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
      // übrige APPn (IPTC, Photoshop, MPF …) und Kommentare: entfernt
    } else if (marker === 0xda) {
      sawSos = true;
      // Kopf des Scans und die entropiecodierten Daten bis zum nächsten echten Marker
      let j = at + length;
      while (j < b.length) {
        if (b[j] === 0xff) {
          const next = b[j + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            j += 2;
            continue;
          }
          if (next === 0xff) {
            j++;
            continue;
          }
          break;
        }
        j++;
      }
      if (j >= b.length) return { ok: false, reason: "corrupt" }; // abgeschnitten, kein EOI
      rest.push(Buffer.from(b.subarray(markerAt, j)));
      at = j;
      continue;
    } else {
      rest.push(segment); // DQT, DHT, DRI, DAC, DNL …
    }
    at += length;
  }
  if (!sawEoi || width === 0 || !sawSos) return { ok: false, reason: "corrupt" };
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (jfif) parts.push(jfif);
  if (orientation !== 1) parts.push(jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), minimalTiff(orientation)])));
  parts.push(...rest, Buffer.from([0xff, 0xd9]));
  const bytes = Buffer.concat(parts);
  return { ok: true, kind: "jpeg", bytes, width, height, orientation, removedBytes: Math.max(0, end - bytes.length) + (b.length - end) };
}

const KEEP_PNG = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "pHYs", "hIST", "sPLT"]);

function pngChunk(name: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(name, 4, "latin1");
  const body = Buffer.concat([head, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body, 4, body.length), 0);
  return Buffer.concat([body, crc]);
}

function sanitizePng(b: Uint8Array, limits: ImageLimits): SanitizedImage | SanitizeFailure {
  const info = inspectPng(b, { maxWidth: limits.maxSide, maxHeight: limits.maxSide, maxPixels: limits.maxPixels, maxChunks: 1024 });
  if (!info.ok) return { ok: false, reason: info.reason === "size" ? "size" : "corrupt" };
  const out: Buffer[] = [Buffer.from(b.subarray(0, 8))];
  let orientation = 1;
  let at = 8;
  while (at + 12 <= b.length) {
    const length = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
    const name = ascii(b, at + 4, at + 8);
    const whole = Buffer.from(b.subarray(at, at + 12 + length));
    if (name === "eXIf") orientation = orientationOfTiff(b.subarray(at + 8, at + 8 + length));
    if (KEEP_PNG.has(name)) out.push(whole);
    at += 12 + length;
  }
  // eXIf liegt in der Datei meist hinter IDAT: die Ausrichtung ist erst nach dem Durchlauf bekannt, der Block kommt direkt hinter IHDR
  if (orientation !== 1) out.splice(2, 0, pngChunk("eXIf", minimalTiff(orientation)));
  const bytes = Buffer.concat(out);
  return { ok: true, kind: "png", bytes, width: info.width, height: info.height, orientation, removedBytes: Math.max(0, b.length - bytes.length) };
}

/** Bereinigt ein JPEG oder PNG (siehe Kopfkommentar). Das Ergebnis ist ein eigener Puffer; das Original bleibt unberührt. */
export function sanitizeImage(input: Uint8Array, limits: ImageLimits = IMAGE_LIMITS): SanitizedImage | SanitizeFailure {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return sanitizeJpeg(input, limits);
  if (input.length >= 8 && input[0] === 0x89 && ascii(input, 1, 4) === "PNG") return sanitizePng(input, limits);
  return { ok: false, reason: "format" };
}
