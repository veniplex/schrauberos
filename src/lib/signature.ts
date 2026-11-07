/**
 * Unterschrift am Touchscreen: Die Logik (Striche aufnehmen, löschen, rückgängig, als PNG mit Größengrenze ausgeben) ohne DOM, hinter der austauschbaren Schnittstelle
 * `SignatureSurface` – im Browser ist es ein `<canvas>` (`components/ui/signature.tsx`), im Test eine Attrappe. Der Baustein bietet außerdem den barrierefreien Weg „Namen tippen und
 * bestätigen“; beide Ergebnisse haben dieselbe Form (`SignatureValue`) und werden mit `parseSignatureValue` serverseitig gelesen.
 */

export type Point = { x: number; y: number };

/** Zeichenfläche. `line`/`dot` zeichnen in Fläche-Koordinaten (Punkte), `toPng` liefert die Fläche als Data-URL `data:image/png;base64,…`. */
export interface SignatureSurface {
  readonly width: number;
  readonly height: number;
  clear(): void;
  line(from: Point, to: Point, lineWidth: number): void;
  dot(at: Point, lineWidth: number): void;
  toPng(): string;
}
export type SurfaceFactory = (width: number, height: number) => SignatureSurface;

export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;
/** Obergrenze des PNG (Bytes). Eine übliche Unterschrift hat 3–10 KB; die Grenze fängt Rauschen und missbräuchliche Eingaben. */
export const SIGNATURE_MAX_BYTES = 48 * 1024;
/** Weniger Tinte als diese Strichlänge (in Punkten) gilt als leer: ein versehentliches Antippen ist keine Unterschrift. */
export const MIN_INK_LENGTH = 24;
export const MAX_POINTS = 20_000;
const SCALES = [1, 0.75, 0.5, 0.35];
const MIN_STEP = 0.6;

export const PNG_DATA_URL = "data:image/png;base64,";

/** Größe der Daten hinter einer Base64-Data-URL in Bytes. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export type SignatureExport = { ok: true; dataUrl: string; bytes: number; scale: number } | { ok: false; reason: "empty" | "tooLarge" };

export type SignaturePad = {
  /** Strich beginnen (Zeigerkontakt) */
  down(point: Point): void;
  move(point: Point): void;
  up(): void;
  clear(): void;
  /** letzten Strich entfernen */
  undo(): void;
  /** hat die Person überhaupt etwas gezeichnet? */
  isEmpty(): boolean;
  strokeCount(): number;
  /** als PNG unter der Größengrenze ausgeben (verkleinert, wenn nötig) */
  exportPng(): SignatureExport;
};

const length = (stroke: Point[]) => stroke.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - stroke[i].x, p.y - stroke[i].y), 0);

export function createSignaturePad(options: { surface: SignatureSurface; factory: SurfaceFactory; maxBytes?: number; lineWidth?: number }): SignaturePad {
  const { surface, factory } = options;
  const maxBytes = options.maxBytes ?? SIGNATURE_MAX_BYTES;
  const lineWidth = options.lineWidth ?? 2.6;
  let strokes: Point[][] = [];
  let current: Point[] | null = null;
  let points = 0;

  const draw = (target: SignatureSurface, scale: number) => {
    const width = Math.max(1, lineWidth * scale);
    for (const stroke of strokes) {
      target.dot({ x: stroke[0].x * scale, y: stroke[0].y * scale }, width);
      for (let i = 1; i < stroke.length; i++) target.line({ x: stroke[i - 1].x * scale, y: stroke[i - 1].y * scale }, { x: stroke[i].x * scale, y: stroke[i].y * scale }, width);
    }
  };
  const redraw = () => {
    surface.clear();
    draw(surface, 1);
  };
  const inkLength = () => strokes.reduce((sum, stroke) => sum + length(stroke), 0);

  return {
    down(point) {
      if (points >= MAX_POINTS) return;
      current = [point];
      strokes.push(current);
      points++;
      surface.dot(point, lineWidth);
    },
    move(point) {
      if (!current || points >= MAX_POINTS) return;
      const last = current[current.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return;
      current.push(point);
      points++;
      surface.line(last, point, lineWidth);
    },
    up() {
      current = null;
    },
    clear() {
      strokes = [];
      current = null;
      points = 0;
      surface.clear();
    },
    undo() {
      current = null;
      const removed = strokes.pop();
      points -= removed?.length ?? 0;
      redraw();
    },
    isEmpty: () => inkLength() < MIN_INK_LENGTH,
    strokeCount: () => strokes.length,
    exportPng() {
      if (inkLength() < MIN_INK_LENGTH) return { ok: false, reason: "empty" };
      for (const scale of SCALES) {
        const target = factory(Math.max(1, Math.round(surface.width * scale)), Math.max(1, Math.round(surface.height * scale)));
        draw(target, scale);
        const dataUrl = target.toPng();
        if (!dataUrl.startsWith(PNG_DATA_URL)) return { ok: false, reason: "tooLarge" };
        const bytes = dataUrlBytes(dataUrl);
        if (bytes <= maxBytes) return { ok: true, dataUrl, bytes, scale };
      }
      return { ok: false, reason: "tooLarge" };
    },
  };
}

/* ------------------------------------------------------------------ Wert für Formular und Server */

/** Ergebnis der Unterschrift im Formularfeld: gezeichnet als PNG-Data-URL, getippt als `typed:<Name>`. */
export type SignatureValue = { kind: "drawn"; dataUrl: string } | { kind: "typed"; name: string };

export const TYPED_PREFIX = "typed:";
export const TYPED_NAME_MAX = 80;

export const serializeSignature = (value: SignatureValue | null): string => (value === null ? "" : value.kind === "drawn" ? value.dataUrl : `${TYPED_PREFIX}${value.name}`);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Liest den Wert aus dem Formularfeld **auf dem Server** (Fremdeingabe!): gezeichnet → echte PNG-Bytes (Magic Bytes, Größengrenze), getippt → bereinigter Name. `null` bei allem anderen.
 * Der Aufrufer speichert die PNG-Bytes als Datei (`files.ts`), nie die Data-URL in der Datenbank.
 */
export function parseSignatureValue(raw: string, options: { maxBytes?: number } = {}): { kind: "drawn"; png: Buffer } | { kind: "typed"; name: string } | null {
  if (raw.startsWith(PNG_DATA_URL)) {
    const maxBytes = options.maxBytes ?? SIGNATURE_MAX_BYTES;
    const base64 = raw.slice(PNG_DATA_URL.length);
    if (base64.length > Math.ceil((maxBytes * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
    const png = Buffer.from(base64, "base64");
    if (png.length === 0 || png.length > maxBytes || !PNG_MAGIC.every((byte, i) => png[i] === byte)) return null;
    return { kind: "drawn", png };
  }
  if (raw.startsWith(TYPED_PREFIX)) {
    // Steuerzeichen aus Fremdeingabe entfernen
    const name = raw.slice(TYPED_PREFIX.length).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
    return name && [...name].length <= TYPED_NAME_MAX ? { kind: "typed", name } : null;
  }
  return null;
}
