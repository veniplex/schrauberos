/**
 * Strukturprüfung einer PNG-Datei ohne Dekodierung (reine Funktion, keine Abhängigkeit): Signatur, `IHDR` an erster Stelle (Maße, Bittiefe, Farbtyp), danach eine lückenlose Kette
 * gültiger Teile (Länge, Typ, **CRC-32**) bis `IEND`, mindestens ein `IDAT`, **keine Bytes dahinter**. Die Maße sind begrenzt – sie bestimmen den Speicher, den ein Dekoder braucht (eine kleine
 * Datei kann sonst Hunderte Megabyte deklarieren: Dekompressionsbombe). Der Inhalt der Bilddaten wird nicht geprüft; wer das Bild später dekodiert (PDF), kennt dank der Grenze die
 * Größenordnung.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let table: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (wie PNG und zlib) über `bytes[from, to)`. */
export function crc32(bytes: Uint8Array, from = 0, to = bytes.length): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const type = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/** erlaubte Bittiefen je Farbtyp (PNG-Spezifikation) */
const BIT_DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

export type PngLimits = { maxWidth: number; maxHeight: number; maxPixels?: number; maxChunks?: number };
export type PngInfo = { ok: true; width: number; height: number } | { ok: false; reason: "signature" | "header" | "size" | "chunks" | "crc" | "end" | "data" | "trailing" };

export function inspectPng(bytes: Uint8Array, limits: PngLimits): PngInfo {
  const maxChunks = limits.maxChunks ?? 256;
  if (bytes.length < 8 + 25 + 12 || !SIGNATURE.every((b, i) => bytes[i] === b)) return { ok: false, reason: "signature" };
  let at = 8;
  let width = 0;
  let height = 0;
  let sawData = false;
  let afterData = false;
  for (let index = 0; index < maxChunks; index++) {
    if (at + 12 > bytes.length) return { ok: false, reason: "chunks" };
    const length = u32(bytes, at);
    const name = type(bytes, at + 4);
    // Länge innerhalb der Datei (und nicht so groß, dass die Summe überläuft)
    if (length > bytes.length - at - 12) return { ok: false, reason: "chunks" };
    if (!/^[A-Za-z]{4}$/.test(name)) return { ok: false, reason: "chunks" };
    if (crc32(bytes, at + 4, at + 8 + length) !== u32(bytes, at + 8 + length)) return { ok: false, reason: "crc" };
    const data = at + 8;
    if (index === 0) {
      if (name !== "IHDR" || length !== 13) return { ok: false, reason: "header" };
      width = u32(bytes, data);
      height = u32(bytes, data + 4);
      const depth = bytes[data + 8];
      const color = bytes[data + 9];
      if (!(BIT_DEPTHS[color] ?? []).includes(depth) || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] > 1) return { ok: false, reason: "header" };
      if (width < 1 || height < 1 || width > limits.maxWidth || height > limits.maxHeight || width * height > (limits.maxPixels ?? limits.maxWidth * limits.maxHeight)) return { ok: false, reason: "size" };
    } else if (name === "IHDR") {
      return { ok: false, reason: "header" };
    } else if (name === "IDAT") {
      if (afterData) return { ok: false, reason: "data" }; // IDAT-Teile müssen aufeinanderfolgen
      sawData = true;
    } else if (name === "IEND") {
      if (length !== 0 || !sawData) return { ok: false, reason: "end" };
      // nichts hinter dem Ende (kein angehängter Inhalt)
      return at + 12 === bytes.length ? { ok: true, width, height } : { ok: false, reason: "trailing" };
    } else if (sawData) {
      afterData = true;
    }
    at += 12 + length;
  }
  return { ok: false, reason: "chunks" };
}
