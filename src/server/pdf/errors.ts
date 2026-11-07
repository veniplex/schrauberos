export type PdfErrorCode = "tooManyPages" | "tooLarge" | "invalid";

/** Fehler der PDF-Erzeugung (Grenzen und ungültige Angaben); Meldungen sind nur für das Protokoll, nie für Menschen. */
export class PdfError extends Error {
  constructor(readonly code: PdfErrorCode, detail?: string) {
    super(`PDF: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "PdfError";
  }
}
