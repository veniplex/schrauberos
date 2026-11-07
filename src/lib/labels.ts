/**
 * Etikettenformate (F8 „Druck & Etiketten“): Maße und Aufteilung der Etiketten, die die Funktionen drucken (Reifenlager). Reine Zahlen – ohne PDF, ohne Oberfläche –, damit PDF (`server/pdf/labels.ts`) und
 * Druckseite (`components/ui/print-label.tsx`) dieselben Maße benutzen.
 *
 *  - `62x29` und `100x50`: **Einzeletikett** auf der Rolle eines Etikettendruckers (Brother QL, Dymo …): jede Seite ist genau ein Etikett.
 *  - `sheet-3x8`: **A4-Bogen** mit 3 Spalten × 8 Zeilen (24 Etiketten zu 70 × 37,125 mm, ohne Rand – das Raster der gängigen Bögen im Format 70 × 37 mm). Mit `skip` beginnt der Druck
 *    hinter bereits benutzten Feldern eines angebrochenen Bogens.
 */

export const LABEL_FORMATS = ["62x29", "100x50", "sheet-3x8"] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];
export const DEFAULT_LABEL_FORMAT: LabelFormat = "62x29";

export type LabelGeometry = {
  id: LabelFormat;
  kind: "single" | "sheet";
  /** Seitengröße in Millimeter */
  pageWidthMm: number;
  pageHeightMm: number;
  /** Größe eines Etiketts in Millimeter */
  cellWidthMm: number;
  cellHeightMm: number;
  columns: number;
  rows: number;
};

const GEOMETRY: Record<LabelFormat, LabelGeometry> = {
  "62x29": { id: "62x29", kind: "single", pageWidthMm: 62, pageHeightMm: 29, cellWidthMm: 62, cellHeightMm: 29, columns: 1, rows: 1 },
  "100x50": { id: "100x50", kind: "single", pageWidthMm: 100, pageHeightMm: 50, cellWidthMm: 100, cellHeightMm: 50, columns: 1, rows: 1 },
  "sheet-3x8": { id: "sheet-3x8", kind: "sheet", pageWidthMm: 210, pageHeightMm: 297, cellWidthMm: 70, cellHeightMm: 297 / 8, columns: 3, rows: 8 },
};

export const labelGeometry = (format: LabelFormat): LabelGeometry => GEOMETRY[format];

/** Etiketten je Bogen. */
export const labelsPerPage = (format: LabelFormat): number => GEOMETRY[format].columns * GEOMETRY[format].rows;

export const isLabelFormat = (value: unknown): value is LabelFormat => typeof value === "string" && (LABEL_FORMATS as readonly string[]).includes(value);

/** Unbekanntes oder fehlendes Format → Standard (nie ein Fehler: es ist nur eine Voreinstellung). */
export const parseLabelFormat = (value: unknown): LabelFormat => (isLabelFormat(value) ? value : DEFAULT_LABEL_FORMAT);

/** Höchstzahl gleicher Etiketten in einem Druck (ein Satz bekommt meist zwei: Reifen und Regal). */
export const MAX_LABEL_COPIES = 24;

/** Ganzzahl in Grenzen aus einem Parameter; fehlend oder ungültig → `fallback`. */
export function parseBoundedInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return fallback;
  const n = Number(value);
  return n >= min && n <= max ? n : fallback;
}

/** Was ein Etikett zeigt (die Funktion füllt es, Layout und Format sind Sache der Bausteine): Hauptzeile groß, Zeilen darunter klein, optional ein QR-Code (der Inhalt ist eine absolute Adresse). */
export type LabelContent = {
  title: string;
  lines: readonly string[];
  /** Inhalt des QR-Codes (ein Link); `null` = ohne QR-Code */
  qr: string | null;
};
