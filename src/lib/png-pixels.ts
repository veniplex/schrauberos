import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/**
 * Prüfsumme eines PNG über seine **Bildpunkte** statt über die Bytes der Datei (nur Server): Dieselbe Zeichnung ergibt dieselbe Summe, auch wenn zusätzliche Teile angehängt, die Kompression oder die
 * Zeilenfilter geändert wurden (die Bilddaten werden entpackt und entfiltert, nicht neu kodiert). Grundlage der Sperre „ein Unterschriftsbild gilt für genau eine Checkliste“.
 * Erwartet ein bereits bereinigtes, geprüftes PNG (`sanitizeImage`, nur kritische Teile); verschachtelte (Adam7-)Bilder werden über den entpackten Datenstrom gerechnet (selten, Browser liefern sie nicht).
 * `null`, wenn sich das Bild nicht entpacken lässt – der Aufrufer fällt dann auf die Prüfsumme der Bytes zurück.
 */
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const MAX_RAW_BYTES = 64 * 1024 * 1024;

export function pngPixelHash(png: Uint8Array): string | null {
  try {
    const hash = createHash("sha256");
    let at = 8;
    let width = 0;
    let height = 0;
    let depth = 0;
    let color = 0;
    let interlace = 0;
    const idat: Uint8Array[] = [];
    const palette: Uint8Array[] = [];
    while (at + 12 <= png.length) {
      const length = u32(png, at);
      const name = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
      const data = png.subarray(at + 8, at + 8 + length);
      if (name === "IHDR") {
        width = u32(data, 0);
        height = u32(data, 4);
        depth = data[8];
        color = data[9];
        interlace = data[12];
      } else if (name === "PLTE") palette.push(data);
      else if (name === "IDAT") idat.push(data);
      at += 12 + length;
    }
    const channels = CHANNELS[color];
    if (!channels || width < 1 || height < 1 || idat.length === 0) return null;
    const bitsPerPixel = channels * depth;
    const stride = Math.ceil((width * bitsPerPixel) / 8);
    const expected = height * (stride + 1);
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: Math.min(MAX_RAW_BYTES, interlace === 0 ? expected : MAX_RAW_BYTES) });
    hash.update(`${width}x${height}:${depth}:${color}:${interlace}:`);
    for (const entry of palette) hash.update(entry);
    if (interlace !== 0) return hash.update(raw).digest("hex");
    if (raw.length !== expected) return null;
    const bpp = Math.max(1, bitsPerPixel >> 3);
    let previous = Buffer.alloc(stride);
    for (let row = 0; row < height; row++) {
      const filter = raw[row * (stride + 1)];
      const line = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)));
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? line[x - bpp] : 0;
        const up = previous[x];
        const upLeft = x >= bpp ? previous[x - bpp] : 0;
        let add = 0;
        if (filter === 1) add = left;
        else if (filter === 2) add = up;
        else if (filter === 3) add = (left + up) >> 1;
        else if (filter === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        } else if (filter !== 0) return null;
        line[x] = (line[x] + add) & 0xff;
      }
      hash.update(line);
      previous = line;
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}
