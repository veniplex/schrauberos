import { crc32, inspectPng } from "./png";

/**
 * Bereinigung hochgeladener Fotos **ohne native Bibliothek** (reine Segmentarbeit an den Bytes, nichts wird dekodiert): Maße aus dem Dateikopf prüfen (Dekompressionsbomben), Metadaten entfernen,
 * die Drehung erhalten. Läuft auf dem Server für **jeden** Upload – Oberfläche wie API (der Browser verkleinert Fotos zwar, aber nur größere, und ein API-Client gar nicht).
 *
 * **Positivliste (Allowlist), keine Sperrliste:** Behalten wird nur, was ausdrücklich bekannt **und in Länge und Aufbau geprüft** ist; alles andere fällt weg (oder die Datei gilt als beschädigt). Ein unbekannter
 * Marker, ein Anhängsel hinter einem erlaubten Teil oder ein zu langer „fester“ Block kann so keine Nutzlast durchreichen.
 *  - **JPEG:** SOI, DQT/DHT/DRI/SOFn/SOS samt Aufbauprüfung (DQT: ganze Tabellen, DHT: Zähler und Werte, DRI: genau 4 Bytes, SOF/SOS: Länge passend zur Komponentenzahl), die entropiecodierten Daten (samt RSTn),
 *    das JFIF-Kopfstück (ohne Vorschaubild), **ICC-Profil** (APP2 „ICC_PROFILE“: lückenlose Folge, höchstens 128 KB, Kopf mit „acsp“ und stimmender Größe – sonst entfällt es), **Adobe** (APP14: genau die 12 Bytes) und
 *    – nur bei Drehung – ein **minimaler Exif-Block mit der Ausrichtung**. Alles andere (APP1 Exif/GPS/XMP, APP13 IPTC, übrige APPn, Kommentare, DAC/DNL, unbekannte Marker, **alles hinter EOI**) fällt weg.
 *    Arithmetisch codierte und verlustfreie SOF-Arten gelten als nicht unterstützt (beschädigt).
 *  - **PNG:** IHDR, PLTE, IDAT, IEND und die harmlosen Teile mit **fester erwarteter Länge**: tRNS (je Farbtyp), gAMA (4), cHRM (32), sRGB (1), pHYs (9), iCCP (Name, Methode 0, höchstens 128 KB) – jeweils höchstens einmal
 *    und vor den Bilddaten; eine falsche Länge macht die Datei „beschädigt“. Entfernt werden tEXt/zTXt/iTXt (auch XMP), eXIf, tIME, sBIT/bKGD/hIST/sPLT, Animationsteile und alles Unbekannte; ein unbekannter
 *    kritischer Teil ist ein Fehler. Mit `criticalOnly` (Unterschrift) bleiben nur IHDR, PLTE, IDAT und IEND.
 *  - **Drehung bleibt:** Die Exif-Ausrichtung (1–8) wird vor dem Entfernen gelesen; ist sie nicht 1, schreibt die Bereinigung einen **minimalen Exif-Block nur mit der Ausrichtung** zurück (JPEG: APP1,
 *    PNG: eXIf). So zeigt jede Ansicht das Foto richtig herum, ohne dass Ort oder Kamera mitreisen.
 *  - **Grenzen:** Die Zahl der Teile ist begrenzt (JPEG: Segmente, PNG: Chunks, großzügig, aber nie unbegrenzt); die Verarbeitung ist linear (kein Spread über große Listen), die ganze Funktion fängt jeden Fehler ab
 *    (`corrupt` statt Ausnahme).
 *  - Die **entropiecodierten Daten** (JPEG-Scan, PNG-IDAT) können ohne Neukodierung immer Nutzlast tragen; das lässt sich ohne Dekodieren und Neukodieren nicht lösen (die Hilfe sagt es nicht anders).
 *  - HEIC/HEIF, SVG, GIF und WebP nimmt der Upload nicht an (sie lassen sich ohne Dekoder nicht sicher bereinigen).
 * Der Aufrufer prüft vorher den Inhalt (`checkUpload`) und die Dateigröße.
 */

export const IMAGE_LIMITS = {
  /** Obergrenze der Bildpunkte (Breite × Höhe): bestimmt den Speicher eines späteren Dekoders (50 Megapixel) */
  maxPixels: 50_000_000,
  /** längste Kante */
  maxSide: 20_000,
} as const;

/** Segmente eines JPEG ohne die entropiecodierten Daten (ein Foto hat einige Dutzend; Progressive mit vielen Scans bleiben weit darunter). */
const MAX_JPEG_SEGMENTS = 10_000;
/** Teile einer PNG-Datei (große Dateien aus Encodern mit kleinen IDAT-Teilen haben Tausende; die Verarbeitung ist linear). */
const MAX_PNG_CHUNKS = 100_000;
/** ICC-Profil insgesamt (übliche Profile: 0,5–3 KB, große bis wenige Hundert KB; Obergrenze für eingebettete Profile) */
const MAX_ICC_BYTES = 131_072;

export type ImageLimits = { maxPixels: number; maxSide: number };
export type SanitizeOptions = {
  /** nur die kritischen PNG-Teile behalten (Unterschriften: IHDR, PLTE, IDAT, IEND), keine Ausrichtung */
  criticalOnly?: boolean;
};
export type SanitizedImage = { ok: true; kind: "jpeg" | "png"; bytes: Buffer; width: number; height: number; orientation: number; removedBytes: number };
export type SanitizeFailure = { ok: false; reason: "format" | "corrupt" | "size" };

const CORRUPT: SanitizeFailure = { ok: false, reason: "corrupt" };

const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const ascii = (b: Uint8Array, from: number, to: number) => {
  let out = "";
  for (let i = from; i < Math.min(to, b.length); i++) out += String.fromCharCode(b[i]);
  return out;
};

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

function jpegSegment(marker: number, payload: Uint8Array): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** DQT: ganze Tabellen (Pq 0/1, Tq 0–3: 64 bzw. 128 Bytes), nichts übrig. */
function validDqt(data: Uint8Array): boolean {
  let at = 0;
  if (data.length === 0) return false;
  while (at < data.length) {
    const pq = data[at] >> 4;
    const tq = data[at] & 15;
    if (pq > 1 || tq > 3) return false;
    at += 1 + (pq === 0 ? 64 : 128);
  }
  return at === data.length;
}

/** DHT: je Tabelle Klasse/Ziel, 16 Zähler und genau so viele Werte; nichts übrig. */
function validDht(data: Uint8Array): boolean {
  let at = 0;
  if (data.length === 0) return false;
  while (at < data.length) {
    if (at + 17 > data.length) return false;
    const tc = data[at] >> 4;
    const th = data[at] & 15;
    if (tc > 1 || th > 3) return false;
    let values = 0;
    for (let i = 1; i <= 16; i++) values += data[at + i];
    if (values > 256) return false;
    at += 17 + values;
  }
  return at === data.length;
}

/** ICC-Profil aus den APP2-Teilen: lückenlose Folge 1..n, Obergrenze, Kopf „acsp“ mit stimmender Größe. */
function validIcc(chunks: Array<{ seq: number; count: number; data: Uint8Array }>): boolean {
  if (chunks.length === 0) return false;
  const count = chunks[0].count;
  if (count < 1 || chunks.length !== count) return false;
  let total = 0;
  for (const [i, chunk] of chunks.entries()) {
    if (chunk.count !== count || chunk.seq !== i + 1) return false;
    total += chunk.data.length;
    if (total > MAX_ICC_BYTES) return false;
  }
  if (total < 128) return false;
  const profile = Buffer.concat(chunks.map((c) => c.data));
  return u32(profile, 0) === profile.length && ascii(profile, 36, 40) === "acsp";
}

function sanitizeJpeg(b: Uint8Array, limits: ImageLimits): SanitizedImage | SanitizeFailure {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return CORRUPT;
  let at = 2;
  let jfif: Buffer | null = null;
  let adobe: Uint8Array | null = null;
  const icc: Array<{ seq: number; count: number; data: Uint8Array; segment: Uint8Array }> = [];
  const body: Uint8Array[] = [];
  let orientation = 1;
  let sawExif = false;
  let width = 0;
  let height = 0;
  let sawSos = false;
  let sawEoi = false;
  let segments = 0;
  while (at < b.length) {
    if (b[at] !== 0xff) return CORRUPT;
    while (at + 1 < b.length && b[at + 1] === 0xff) at++; // Füllbytes
    if (at + 1 >= b.length) return CORRUPT;
    const marker = b[at + 1];
    const markerAt = at;
    at += 2;
    if (marker === 0xd9) {
      sawEoi = true;
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x00) return CORRUPT;
    if (marker === 0x01) continue; // TEM: ohne Länge, entfällt
    if (++segments > MAX_JPEG_SEGMENTS) return CORRUPT;
    if (at + 2 > b.length) return CORRUPT;
    const length = u16(b, at);
    if (length < 2 || at + length > b.length) return CORRUPT;
    const data = b.subarray(at + 2, at + length);
    const segment = b.subarray(markerAt, at + length);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // nur Huffman-codierte Baseline, erweiterte und Progressive-Bilder (C0–C2); arithmetische und verlustfreie Arten bleiben ungeprüft
      if (marker > 0xc2) return CORRUPT;
      if (data.length < 6 || width !== 0) return CORRUPT;
      const components = data[5];
      if (components < 1 || components > 4 || data.length !== 6 + 3 * components) return CORRUPT;
      height = u16(data, 1);
      width = u16(data, 3);
      if (width < 1 || height < 1 || width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) return { ok: false, reason: "size" };
      body.push(segment);
    } else if (marker === 0xdb) {
      if (!validDqt(data)) return CORRUPT;
      body.push(segment);
    } else if (marker === 0xc4) {
      if (!validDht(data)) return CORRUPT;
      body.push(segment);
    } else if (marker === 0xdd) {
      if (data.length !== 2) return CORRUPT;
      body.push(segment);
    } else if (marker === 0xe0) {
      // nur die Kopfangaben von JFIF, ohne eingebettetes Vorschaubild; JFXX und alles andere entfällt
      if (!jfif && data.length >= 14 && ascii(data, 0, 5) === "JFIF\0") jfif = jpegSegment(0xe0, Buffer.concat([data.subarray(0, 12), Buffer.from([0, 0])]));
    } else if (marker === 0xe1) {
      if (!sawExif && ascii(data, 0, 6) === "Exif\0\0") {
        sawExif = true;
        orientation = orientationOfTiff(data.subarray(6));
      }
    } else if (marker === 0xe2) {
      if (data.length >= 14 && ascii(data, 0, 12) === "ICC_PROFILE\0") icc.push({ seq: data[12], count: data[13], data: data.subarray(14), segment });
    } else if (marker === 0xee) {
      // Adobe: genau die zwölf Bytes (Kennung, Version, zwei Flags, Transformation 0–2)
      if (!adobe && data.length === 12 && ascii(data, 0, 5) === "Adobe" && data[11] <= 2) adobe = segment;
    } else if (marker === 0xda) {
      // Scan: Kopf (Komponentenzahl passend zur Länge) und die entropiecodierten Daten bis zum nächsten echten Marker
      if (width === 0) return CORRUPT; // kein SOF davor
      sawSos = true;
      const components = data[0];
      if (data.length < 1 || components < 1 || components > 4 || data.length !== 1 + 2 * components + 3) return CORRUPT;
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
      if (j >= b.length) return CORRUPT; // abgeschnitten, kein EOI
      body.push(b.subarray(markerAt, j));
      at = j;
      continue;
    }
    // alles Übrige (übrige APPn, Kommentare, DAC/DNL, unbekannte und reservierte Marker): entfernt
    at += length;
  }
  if (!sawEoi || width === 0 || !sawSos) return CORRUPT;
  const parts: Uint8Array[] = [Buffer.from([0xff, 0xd8])];
  if (jfif) parts.push(jfif);
  if (orientation !== 1) parts.push(jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), minimalTiff(orientation)])));
  if (validIcc(icc)) for (const chunk of icc) parts.push(chunk.segment);
  if (adobe) parts.push(adobe);
  for (const part of body) parts.push(part);
  parts.push(Buffer.from([0xff, 0xd9]));
  const bytes = Buffer.concat(parts);
  return { ok: true, kind: "jpeg", bytes, width, height, orientation, removedBytes: Math.max(0, b.length - bytes.length) };
}

function pngChunk(name: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(name, 4, "latin1");
  const body = Buffer.concat([head, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body, 4, body.length), 0);
  return Buffer.concat([body, crc]);
}

/** iCCP: Profilname (1–79 druckbare Latin-1-Zeichen), 0, Kompressionsmethode 0, Daten – höchstens 128 KB. */
function validIccp(data: Uint8Array): boolean {
  if (data.length < 4 || data.length > MAX_ICC_BYTES) return false;
  let at = 0;
  while (at < data.length && data[at] !== 0) {
    const c = data[at];
    if (!((c >= 32 && c <= 126) || c >= 161)) return false;
    at++;
  }
  if (at < 1 || at > 79 || at + 2 >= data.length) return false;
  return data[at + 1] === 0;
}

/** Die harmlosen Teile mit fester Form (Name → Prüfung der Daten). */
const ANCILLARY_FIXED: Record<string, (data: Uint8Array) => boolean> = {
  gAMA: (d) => d.length === 4,
  cHRM: (d) => d.length === 32,
  sRGB: (d) => d.length === 1 && d[0] <= 3,
  pHYs: (d) => d.length === 9 && d[8] <= 1,
  iCCP: validIccp,
};

function sanitizePng(b: Uint8Array, limits: ImageLimits, options: SanitizeOptions): SanitizedImage | SanitizeFailure {
  const info = inspectPng(b, { maxWidth: limits.maxSide, maxHeight: limits.maxSide, maxPixels: limits.maxPixels, maxChunks: MAX_PNG_CHUNKS });
  if (!info.ok) return { ok: false, reason: info.reason === "size" ? "size" : "corrupt" };
  const depth = b[24];
  const colorType = b[25];
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let orientation = 1;
  let at = 8;
  let sawIdat = false;
  let palette = 0;
  const seen = new Set<string>();
  while (at + 12 <= b.length) {
    const length = u32(b, at);
    const name = ascii(b, at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + length);
    const whole = b.subarray(at, at + 12 + length);
    at += 12 + length;
    if (name === "IHDR" || name === "IEND") {
      out.push(whole);
    } else if (name === "IDAT") {
      sawIdat = true;
      out.push(whole);
    } else if (name === "PLTE") {
      // Palette: nur bei Farbtypen 2, 3, 6, einmal, vor den Bilddaten, ganze Einträge (höchstens 2^Bittiefe bei Typ 3)
      if (sawIdat || seen.has(name) || colorType === 0 || colorType === 4) return CORRUPT;
      if (length === 0 || length % 3 !== 0 || length > 768 || (colorType === 3 && length / 3 > 2 ** depth)) return CORRUPT;
      seen.add(name);
      palette = length / 3;
      out.push(whole);
    } else if (name === "eXIf") {
      if (!options.criticalOnly) orientation = orientationOfTiff(data);
    } else if (name === "tRNS" || Object.hasOwn(ANCILLARY_FIXED, name)) {
      if (options.criticalOnly) continue;
      if (seen.has(name)) return CORRUPT;
      seen.add(name);
      if (name === "tRNS") {
        // Farbtyp 0: ein Grauwert (2 Bytes), 2: ein Farbwert (6), 3: höchstens ein Wert je Paletteneintrag; bei Alphakanal (4, 6) nicht vorgesehen
        const fits = colorType === 0 ? length === 2 : colorType === 2 ? length === 6 : colorType === 3 ? palette > 0 && length >= 1 && length <= palette : false;
        if (!fits) return CORRUPT;
      } else if (!ANCILLARY_FIXED[name](data)) {
        return CORRUPT; // falsche Länge/Form eines Teils fester Form: kein Platz für Nutzlast
      }
      if (!sawIdat) out.push(whole); // hinter den Bilddaten hat der Teil keine Bedeutung: entfällt
    } else if (name.charCodeAt(0) >= 65 && name.charCodeAt(0) <= 90) {
      return CORRUPT; // unbekannter kritischer Teil: ein Dekoder könnte ihn nicht lesen
    }
    // alles Übrige (Texte, tIME, sBIT, bKGD, hIST, sPLT, Animation, Unbekanntes): entfernt
  }
  // eXIf liegt in der Datei meist hinter IDAT: die Ausrichtung ist erst nach dem Durchlauf bekannt, der Block kommt direkt hinter IHDR
  if (orientation !== 1) out.splice(2, 0, pngChunk("eXIf", minimalTiff(orientation)));
  const bytes = Buffer.concat(out);
  return { ok: true, kind: "png", bytes, width: info.width, height: info.height, orientation, removedBytes: Math.max(0, b.length - bytes.length) };
}

/** Bereinigt ein JPEG oder PNG (siehe Kopfkommentar). Das Ergebnis ist ein eigener Puffer; das Original bleibt unberührt. Jeder unerwartete Fehler ergibt `corrupt`. */
export function sanitizeImage(input: Uint8Array, limits: ImageLimits = IMAGE_LIMITS, options: SanitizeOptions = {}): SanitizedImage | SanitizeFailure {
  try {
    if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return sanitizeJpeg(input, limits);
    if (input.length >= 8 && input[0] === 0x89 && ascii(input, 1, 4) === "PNG") return sanitizePng(input, limits, options);
    return { ok: false, reason: "format" };
  } catch {
    return CORRUPT;
  }
}
