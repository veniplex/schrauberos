/**
 * Das Werkstatt-Logo (P3-5). Es liegt als Daten-URL in der Datenbank (`Workshop.logoDataUrl`), wird aber nicht mehr in jede Seite eingebettet, sondern über die
 * Route `/api/logo` ausgeliefert: einmal geladen und zwischengespeichert (ETag, `?v=` ändert sich mit jeder Änderung des Profils), ohne die Daten in jedem HTML-Dokument.
 *
 * **Kein SVG:** Ein SVG kann Skripte tragen und wäre ein eigenes Dokument der Herkunft der Anwendung. Zugelassen sind nur die Rasterformate; ein früher gespeichertes SVG wird
 * nicht mehr angezeigt (die Werkstatt sieht das Standard-Symbol, bis sie ein neues Logo hochlädt).
 */

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const LOGO_PATH = "/api/logo";

/**
 * Grenzen für Logo und Bilder im PDF (Z6-2 N1): Ein 190-KB-PNG kann 14000 × 3500 Bildpunkte haben, und pdfkit dekodiert es ohne Obergrenze (belegt: 869 MB Arbeitsspeicher je PDF). Ein Logo für 50 mm Breite
 * braucht nicht mehr als 4 Megapixel und 4000 Bildpunkte je Kante. Beim Hochladen (PNG/JPEG über `sanitizeImage`, das zugleich Metadaten entfernt) und **erneut beim Erzeugen jedes PDFs** geprüft
 * (auch für früher gespeicherte Logos); ein Logo darüber erscheint im PDF nicht (Standardmarke).
 */
export const LOGO_LIMITS = { maxPixels: 4_000_000, maxSide: 4000 } as const;

/** Zerlegt die gespeicherte Daten-URL; `null` bei allem, was kein erlaubtes Rasterbild ist (SVG, Unsinn, leer). */
export function parseLogoDataUrl(dataUrl: string | null | undefined): { mime: LogoType; data: Buffer } | null {
  if (!dataUrl) return null;
  const mime = LOGO_TYPES.find((type) => dataUrl.startsWith(`data:${type};base64,`));
  if (!mime) return null;
  const data = Buffer.from(dataUrl.slice(`data:${mime};base64,`.length), "base64");
  return data.length > 0 ? { mime, data } : null;
}

/** Adresse des Logos für `<img src>`; `null`, wenn es keins (oder nur ein nicht mehr zugelassenes) gibt. `v` ändert sich mit dem Profil und umgeht den Zwischenspeicher. */
export function logoSrc(workshop: { logoDataUrl: string | null; updatedAt: Date }): string | null {
  const { logoDataUrl } = workshop;
  if (!logoDataUrl || !LOGO_TYPES.some((type) => logoDataUrl.startsWith(`data:${type};base64,`))) return null;
  return `${LOGO_PATH}?v=${workshop.updatedAt.getTime()}`;
}
