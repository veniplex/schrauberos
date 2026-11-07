import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Eingebettete Schrift der PDF-Erzeugung: Noto Sans (Regular und Bold, SIL Open Font License) liegt als Datei unter `assets/fonts/` (Quelle, Lizenz und Prüfsummen:
 * `assets/fonts/SOURCE.txt`). Das Image hat keine Systemschriften und die Laufzeit lädt nichts aus dem Netz; das Dockerfile kopiert `assets/` ins Paket.
 * Gelesen wird einmal je Prozess (zwei Dateien, rund 1,2 MB im Speicher). Der Pfad hängt am Arbeitsverzeichnis wie `docs/` und die Migrationen (`process.cwd()` ist das Paketverzeichnis).
 */
export const FONT_DIR = () => path.join(process.cwd(), "assets", "fonts");
export const FONT_FILES = { regular: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" } as const;

export type PdfFonts = { regular: Buffer; bold: Buffer };

let cached: PdfFonts | null = null;

export function loadFonts(): PdfFonts {
  if (!cached) {
    const dir = FONT_DIR();
    cached = { regular: readFileSync(path.join(dir, FONT_FILES.regular)), bold: readFileSync(path.join(dir, FONT_FILES.bold)) };
  }
  return cached;
}
