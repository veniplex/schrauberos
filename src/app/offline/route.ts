import { offlineHtml } from "@/lib/offline-text";

/**
 * Die Offline-Seite (P3-5): ohne Anmeldung erreichbar (`OPEN_PAGES` im Proxy), statisch, ohne Datenbank und ohne Skript. Der Service Worker (`public/sw.js`) lädt sie
 * ohne Cookie und zeigt sie, wenn das Laden einer Seite am Netz scheitert. Keine Seite der Routen-Inventur (`pages.ts`): Sie ist eine Antwort, keine Oberfläche.
 */
export function GET() {
  return new Response(offlineHtml(), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-robots-tag": "noindex" },
  });
}
