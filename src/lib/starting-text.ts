/**
 * Text „Die Anwendung startet“ – fest zweisprachig (in dieser Phase ist die Datenbank noch nicht migriert, Sprache und Design stehen dort).
 * Genutzt von der 503-Antwort des Proxys (`src/proxy.ts`), solange der Start (Sicherung, Migrationen) läuft.
 */
export const STARTING_TEXT = {
  title: "Die Anwendung startet · Starting",
  de: "SchrauberOS startet gerade (Datenbank wird vorbereitet). Das kann nach einem Update einige Minuten dauern. Diese Seite lädt sich selbst neu.",
  en: "SchrauberOS is starting (the database is being prepared). After an update this can take a few minutes. This page reloads itself.",
} as const;

/** Sekunden bis zum nächsten Versuch (Seite lädt selbst neu; zugleich `Retry-After`). */
export const STARTING_RETRY_SECONDS = 5;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Eigenständige Seite (ohne die Anwendung, ohne Datenbank) für die 503-Antwort. */
export function startingHtml(): string {
  return (
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><meta http-equiv="refresh" content="${STARTING_RETRY_SECONDS}"><title>SchrauberOS</title>` +
    `<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:2rem 1rem}main{max-width:40rem;margin:0 auto}</style></head>` +
    `<body><main data-status="starting"><h1>${escapeHtml(STARTING_TEXT.title)}</h1><p>${escapeHtml(STARTING_TEXT.de)}</p><p>${escapeHtml(STARTING_TEXT.en)}</p></main></body></html>`
  );
}
