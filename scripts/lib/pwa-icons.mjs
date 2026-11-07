// Symbole der installierbaren App (P3-5), reproduzierbar aus einer Formel gezeichnet – ohne Netz, ohne Bild-Bibliothek.
//
// Quelle: dieselbe Marke wie in der Seitenleiste, wenn die Werkstatt kein Logo hat (`components/shell/sidebar.tsx`): ein Schraubenschlüssel in Weiß auf der Standard-Akzentfarbe
// `#2459c9` (`--accent`, `src/app/tokens.css`). Der Schlüssel ist hier als Fläche aus einem Rundstab (Griff) und einer Scheibe (Kopf) mit offenem Maul beschrieben und wird
// 4 × 4 überabgetastet; das Ergebnis ist bei jedem Lauf bit-gleich (`src/lib/pwa.test.ts` rechnet neu und vergleicht die Bildpunkte der Dateien unter `public/icons/`).
// Erzeugen: `node scripts/gen-pwa-icons.mjs` (prüfen ohne zu schreiben: `--check`). Das Logo der Werkstatt ist nicht Teil davon: Das Manifest ist statisch (kein Datenbankzugriff vor dem Start).
import { deflateSync, inflateSync } from "node:zlib";

export const ACCENT = [0x24, 0x59, 0xc9];
const WHITE = [0xff, 0xff, 0xff];

/** Die Dateien: Größe, ob die Ecken abgerundet und durchsichtig sind (`rounded`) und wie groß das Zeichen im Bild steht (`glyph`, 1 = ganze Fläche). */
export const ICONS = [
  { file: "icon-192.png", size: 192, rounded: true, glyph: 1, purpose: "any" },
  { file: "icon-512.png", size: 512, rounded: true, glyph: 1, purpose: "any" },
  // maskable: randlos; das Zeichen bleibt im sicheren Kreis (Durchmesser 80 % der Seite), den jedes Gerät mindestens zeigt
  { file: "icon-maskable-512.png", size: 512, rounded: false, glyph: 0.78, purpose: "maskable" },
  // iOS rundet selbst ab und füllt Durchsichtiges schwarz: randlos
  { file: "apple-touch-icon.png", size: 180, rounded: false, glyph: 0.9, purpose: "apple" },
];

// Schraubenschlüssel im Einheitsquadrat (y nach unten): Griff von T nach H, am Kopf H eine Scheibe mit offenem Maul in Richtung des Griffs
const T = [0.3, 0.7];
const H = [0.645, 0.355];
const HANDLE_R = 0.058;
const HEAD_R = 0.165;
const JAW_HALF = 0.056;
const AXIS = (() => {
  const dx = H[0] - T[0];
  const dy = H[1] - T[1];
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len, len };
})();
// Schwerpunkt der Fläche ungefähr in die Mitte rücken
const CENTER = [(T[0] + H[0]) / 2 + 0.02, (T[1] + H[1]) / 2 - 0.02];

function insideWrench(u, v) {
  const px = u - T[0];
  const py = v - T[1];
  const along = px * AXIS.x + py * AXIS.y;
  const across = -px * AXIS.y + py * AXIS.x;
  const clamped = Math.min(AXIS.len, Math.max(0, along));
  const inHandle = Math.hypot(along - clamped, across) <= HANDLE_R;
  const hx = u - H[0];
  const hy = v - H[1];
  const inHead = Math.hypot(hx, hy) <= HEAD_R;
  if (!inHandle && !inHead) return false;
  // Maul: ab der Mitte des Kopfes in Richtung des Griffs nach außen, beidseitig JAW_HALF breit
  const jawAlong = hx * AXIS.x + hy * AXIS.y;
  const jawAcross = -hx * AXIS.y + hy * AXIS.x;
  return !(jawAlong > 0 && Math.abs(jawAcross) < JAW_HALF);
}

const SAMPLES = 4;

function insideRounded(u, v, r) {
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  return Math.hypot(u - cx, v - cy) <= r;
}

/** Bildpunkte (RGBA, zeilenweise) eines Symbols. */
export function renderIcon({ size, rounded, glyph }) {
  const out = Buffer.alloc(size * size * 4);
  const radius = 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ink = 0;
      let shape = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (x + (sx + 0.5) / SAMPLES) / size;
          const v = (y + (sy + 0.5) / SAMPLES) / size;
          if (!rounded || insideRounded(u, v, radius)) shape++;
          // Zeichen: um die Mitte des Bildes, skaliert
          const gu = (u - 0.5) / glyph + CENTER[0];
          const gv = (v - 0.5) / glyph + CENTER[1];
          if (insideWrench(gu, gv)) ink++;
        }
      }
      const n = SAMPLES * SAMPLES;
      const i = (y * size + x) * 4;
      const cover = ink / n;
      out[i] = Math.round(ACCENT[0] * (1 - cover) + WHITE[0] * cover);
      out[i + 1] = Math.round(ACCENT[1] * (1 - cover) + WHITE[1] * cover);
      out[i + 2] = Math.round(ACCENT[2] * (1 - cover) + WHITE[2] * cover);
      out[i + 3] = Math.round((shape / n) * 255);
    }
  }
  return out;
}

// ───────── PNG (nur, was gebraucht wird: 8 Bit RGBA, Filter 0) ─────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

export function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // Bittiefe
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Liest ein von `encodePng` geschriebenes Bild zurück: Größe und Bildpunkte (RGBA). */
export function decodePng(png) {
  let offset = 8;
  let size = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      size = data.readUInt32BE(0);
      if (data.readUInt32BE(4) !== size || data[8] !== 8 || data[9] !== 6) throw new Error("nur quadratische 8-Bit-RGBA-Bilder");
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    if (rows[y * (size * 4 + 1)] !== 0) throw new Error("nur Filter 0");
    rows.copy(out, y * size * 4, y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1));
  }
  return { size, rgba: out };
}
