import { deflateSync } from "node:zlib";
import { crc32 } from "@/lib/png";

/** Ein Teil einer PNG-Datei (Länge, Typ, Daten, CRC) – nur für Tests. */
export function pngChunk(name: string, data: Uint8Array = new Uint8Array(0), options: { badCrc?: boolean } = {}): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(name, 4, "latin1");
  const body = Buffer.concat([head, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((crc32(body, 4, body.length) ^ (options.badCrc ? 1 : 0)) >>> 0, 0);
  return Buffer.concat([body, crc]);
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Ein gültiges PNG (Graustufen, 8 Bit) der Größe `width × height` – nur für Tests. `extra` hängt einen gültigen Ancillary-Teil (`tEXt`) der angegebenen Größe an, um Dateigrößen zu erreichen;
 * `ihdr` überschreibt die deklarierte Größe (ohne dass Bilddaten dazu passen: Dekompressionsbombe).
 */
export function makePng(width = 8, height = 4, options: { extra?: number; ihdr?: { width: number; height: number } } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(options.ihdr?.width ?? width, 0);
  ihdr.writeUInt32BE(options.ihdr?.height ?? height, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 0; // Graustufen
  const row = Buffer.alloc(1 + width, 0x80);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const parts = [PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw))];
  if (options.extra) parts.push(pngChunk("tEXt", Buffer.concat([Buffer.from("Comment\0", "latin1"), Buffer.alloc(options.extra, 0x41)])));
  parts.push(pngChunk("IEND"));
  return Buffer.concat(parts);
}
