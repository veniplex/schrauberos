/**
 * Auslieferung hochgeladener Dateien (Rechnungsbelege, Dokumentationsbilder): Kopfzeilen, die verhindern, dass der Browser eine Datei anders behandelt, als
 * wir sie gespeichert haben.
 *
 *  - `X-Content-Type-Options: nosniff` immer – der Browser nimmt den gelieferten Typ, rät nicht.
 *  - **PDF**: inline möglich; mehr als `nosniff` verträgt der eingebaute PDF-Betrachter nicht (eine `sandbox`-Richtlinie verhindert die Anzeige).
 *  - **Bilder** und alles andere: `Content-Security-Policy: sandbox; default-src 'none'` – selbst wenn jemand die Adresse direkt öffnet, läuft nichts
 *    (kein Skript, kein Formular, kein Zugriff auf die Herkunft der Anwendung).
 *  - **XML** (XRechnung) wird nie angezeigt, sondern immer als Download (`attachment`) geliefert.
 *  - Unbekannte Typen gelten als `application/octet-stream` und werden ebenfalls nur als Download geliefert.
 * Der Dateiname im `Content-Disposition` ist ASCII (kein Einschleusen von Zeilen oder Anführungszeichen) und zusätzlich UTF-8-kodiert (RFC 5987/6266).
 */

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);
const KNOWN_TYPES = new Set([...INLINE_TYPES, "application/xml"]);

/** Nur ASCII, ohne Steuerzeichen, Anführungszeichen, Backslash und Pfadtrenner; nie leer. */
export function asciiFileName(name: string, fallback = "datei"): string {
  const cleaned = name
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\/:*?<>|%;]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.replace(/^\.+/, "") || fallback;
}

/** Wert von `Content-Disposition`. */
export function contentDisposition(disposition: "inline" | "attachment", name: string): string {
  const encoded = encodeURIComponent(name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "datei").replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${asciiFileName(name)}"; filename*=UTF-8''${encoded}`;
}

export type DeliveryOptions = {
  /** gespeicherter Typ */
  mime: string;
  /** Dateiname für den Download */
  name: string;
  /** Download erzwingen */
  download?: boolean;
  /** Zwischenspeicher-Regel (Standard: privat, nicht speichern) */
  cacheControl?: string;
  size?: number;
};

/** Kopfzeilen für die Auslieferung einer gespeicherten Datei. */
export function deliveryHeaders(options: DeliveryOptions): Record<string, string> {
  const known = KNOWN_TYPES.has(options.mime);
  const mime = known ? options.mime : "application/octet-stream";
  const inline = !options.download && INLINE_TYPES.has(mime);
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", options.name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": options.cacheControl ?? "private, no-store",
  };
  if (mime !== "application/pdf") headers["Content-Security-Policy"] = "sandbox; default-src 'none'";
  if (options.size !== undefined) headers["Content-Length"] = String(options.size);
  return headers;
}
