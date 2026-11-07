/**
 * Karten und Zettel (F8): Papiergrößen und das Modell, das Auftragskarte und Terminzettel beschreibt – reine Typen und Hilfen ohne PDF-Bibliothek, damit Seiten (Druckansicht) und PDF dasselbe Modell benutzen,
 * ohne dass eine Seite `pdfkit` laden muss. Das PDF baut `server/pdf/card.ts`, die Druckansicht `components/ui/print-card.tsx`.
 */

export type CardSize = "a4" | "a5" | "a6";
export const CARD_SIZES: readonly CardSize[] = ["a4", "a5", "a6"];
export const isCardSize = (value: unknown): value is CardSize => typeof value === "string" && (CARD_SIZES as readonly string[]).includes(value);
/** Unbekanntes oder fehlendes Papier: Standard der Funktion (nie ein Fehler – es ist nur eine Voreinstellung). */
export const parseCardSize = (value: unknown, allowed: readonly CardSize[], fallback: CardSize): CardSize => (isCardSize(value) && allowed.includes(value) ? value : fallback);

/** Spalte der Tabelle: Überschrift, relative Breite, Ausrichtung */
export type CardColumn = { header: string; weight?: number; align?: "left" | "right" | "center" };

export type CardModel = {
  /** Titel der PDF-Datei (Dokumenteigenschaft) */
  documentTitle: string;
  /** kleine Zeile über der Überschrift (Werkstatt) */
  subtitle?: string;
  title: string;
  facts: ReadonlyArray<readonly [string, string]>;
  /** Textabschnitte unter den Kopfdaten (Kundenwunsch …) */
  blocks?: ReadonlyArray<{ heading: string; text: string }>;
  table?: { heading: string; columns: readonly CardColumn[]; rows: ReadonlyArray<readonly string[]>; empty: string };
  /** Zeilen anderer Funktionen (Annahmeprotokoll …): Beschriftung und Text */
  extras?: ReadonlyArray<readonly [string, string]>;
  /** Schreiblinien für Notizen (höchstens `lines`, so viele, wie auf die Seite passen) */
  notes?: { heading: string; lines: number };
  qr?: { data: string; caption: string } | null;
  /** Text in der Fußzeile (links) */
  footer?: string;
  /** Seitenzahl in der Fußzeile („Seite 2 von 3“, in der Sprache der Oberfläche) */
  pageLabel?: (page: number, total: number) => string;
  creationDate?: Date;
};


export const cardPageSize = (size: CardSize): { widthMm: number; heightMm: number } => ({ a4: { widthMm: 210, heightMm: 297 }, a5: { widthMm: 148, heightMm: 210 }, a6: { widthMm: 105, heightMm: 148 } })[size];
