/**
 * Offline-Seite des Service Workers (`public/sw.js`, Route `/offline`, P3-5) – fest zweisprachig: Sie wird einmal geladen und dann unverändert aus dem Zwischenspeicher gezeigt,
 * ohne Datenbank, ohne Sitzung, ohne Skript (der Link „Erneut versuchen“ ist ein gewöhnlicher Link auf die Startseite). Die Stile stehen als `style`-Attribute (die Richtlinie erlaubt
 * sie, `style-src-attr`), damit die gespeicherte Seite von keinem Nonce abhängt.
 */
export const OFFLINE_TEXT = {
  title: "Keine Verbindung · No connection",
  de: { text: "Der Server ist gerade nicht erreichbar. Bitte die Verbindung prüfen (WLAN der Werkstatt?) und es noch einmal versuchen.", retry: "Erneut versuchen" },
  en: { text: "The server cannot be reached right now. Please check the connection (workshop Wi-Fi?) and try again.", retry: "Try again" },
} as const;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Eigenständige HTML-Seite ohne Skript. */
export function offlineHtml(): string {
  const block = (lang: "de" | "en") =>
    `<section lang="${lang}" style="margin:0 0 1.5rem"><p style="margin:0 0 .75rem">${escapeHtml(OFFLINE_TEXT[lang].text)}</p>` +
    `<p style="margin:0"><a href="/" style="display:inline-block;min-height:44px;line-height:44px;padding:0 1rem;border:1px solid currentColor;border-radius:8px;color:inherit;text-decoration:none">${escapeHtml(OFFLINE_TEXT[lang].retry)}</a></p></section>`;
  return (
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
    `<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>SchrauberOS</title></head>` +
    `<body style="font:16px/1.5 system-ui,sans-serif;margin:0;padding:2rem 1rem"><main data-status="offline" style="max-width:40rem;margin:0 auto">` +
    `<h1 style="font-size:1.25rem;margin:0 0 1rem">${escapeHtml(OFFLINE_TEXT.title)}</h1>${block("de")}${block("en")}</main></body></html>`
  );
}
