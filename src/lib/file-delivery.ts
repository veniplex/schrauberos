/**
 * Auslieferung hochgeladener Dateien (Rechnungsbelege, Dokumentationsbilder): Kopfzeilen, die verhindern, dass der Browser eine Datei anders behandelt, als
 * wir sie gespeichert haben.
 *
 *  - `X-Content-Type-Options: nosniff` immer – der Browser nimmt den gelieferten Typ, rät nicht.
 *  - **PDF**: inline möglich; der eingebaute PDF-Betrachter verträgt weder `sandbox` noch `object-src 'none'`. Deshalb nur `Content-Security-Policy: frame-ancestors 'self'`
 *    (Einbetten im `<iframe>` der Beleg-Vorschau, sonst nirgends).
 *  - **Bilder** und alles andere: `Content-Security-Policy: sandbox; default-src 'none'` – selbst wenn jemand die Adresse direkt öffnet, läuft nichts
 *    (kein Skript, kein Formular, kein Zugriff auf die Herkunft der Anwendung).
 *  - Diese Köpfe sind die **einzige** CSP dieser Antworten: Der Proxy und `next.config` fassen die Dateirouten nicht an (`ROUTE_OWNED_PATHS` in `lib/csp.ts`) – Next hängt die
 *    Kopfzeile einer Route nur an, wenn der Server den Namen nicht schon gesetzt hat.
 *  - **XML** (XRechnung) wird nie angezeigt, sondern immer als Download (`attachment`) geliefert.
 *  - Unbekannte Typen gelten als `application/octet-stream` und werden ebenfalls nur als Download geliefert.
 * Der Dateiname im `Content-Disposition` ist ASCII (kein Einschleusen von Zeilen oder Anführungszeichen) und zusätzlich UTF-8-kodiert (RFC 5987/6266).
 */

import { PDF_CONTENT_SECURITY_POLICY, SANDBOX_CONTENT_SECURITY_POLICY } from "@/lib/csp";

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);
const KNOWN_TYPES = new Set([...INLINE_TYPES, "application/xml"]);

/**
 * Kürzt einen Dateinamen auf höchstens `max` **Zeichen** (nicht UTF-16-Einheiten) und macht ihn wohlgeformt: `slice` schneidet ein Emoji (Ersatzpaar) in der Mitte durch,
 * und `encodeURIComponent` wirft bei einem einzelnen Ersatzzeichen einen `URIError` – der Beleg wäre dauerhaft nicht mehr auslieferbar.
 */
export function truncateName(name: string, max = 120): string {
  return [...name].slice(0, max).join("").toWellFormed();
}

/** Nur ASCII, ohne Steuerzeichen, Anführungszeichen, Backslash und Pfadtrenner; nie leer. */
export function asciiFileName(name: string, fallback = "datei"): string {
  const cleaned = truncateName(name, 400)
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\/:*?<>|%;]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.replace(/^\.+/, "") || fallback;
}

/** Wert von `Content-Disposition`. */
export function contentDisposition(disposition: "inline" | "attachment", name: string): string {
  const encoded = encodeURIComponent(truncateName(name.replace(/[\u0000-\u001f\u007f]/g, "")) || "datei").replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
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
  headers["Content-Security-Policy"] = mime === "application/pdf" ? PDF_CONTENT_SECURITY_POLICY : SANDBOX_CONTENT_SECURITY_POLICY;
  if (options.size !== undefined) headers["Content-Length"] = String(options.size);
  return headers;
}

/**
 * Fehlerantwort einer Dateiroute (401/403/404/422 …): reiner Text mit denselben Schutzköpfen wie die Auslieferung (`nosniff`, Sandbox-CSP, nicht speichern) – auch eine Fehlermeldung wird nie als Seite gedeutet.
 * `extra`: zusätzliche Köpfe (z. B. `x-problems`).
 */
export function errorResponse(status: number, text: string, extra: Record<string, string> = {}): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Security-Policy": SANDBOX_CONTENT_SECURITY_POLICY, ...extra },
  });
}
