/**
 * Text „Neuinstallation nötig“ – fest zweisprachig (Sprache und Design stehen in der Datenbank, die in diesem Zustand niemand anfasst).
 * Genutzt vom Hinweis im Layout (`src/app/reinstall-notice.tsx`) und von der 503-Antwort des Proxys (`src/proxy.ts`).
 */
export const REINSTALL_TEXT = {
  title: "Neuinstallation nötig · Reinstallation required",
  de: [
    "Die Datenbank in diesem Volume stammt aus einer nicht verträglichen Version von SchrauberOS (zum Beispiel 0.1.0). Die Anwendung startet deshalb nicht und hat nichts verändert.",
    "Bitte mit einem neuen, leeren Volume starten und neu einrichten. Daten der alten Version werden nicht übernommen.",
  ],
  en: [
    "The database in this volume comes from an incompatible SchrauberOS version (for example 0.1.0). The application therefore does not start and has not changed anything.",
    "Please start with a new, empty volume and set up again. Data from the old version is not carried over.",
  ],
} as const;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Eigenständige Seite (ohne die Anwendung, ohne Datenbank) für die 503-Antwort; `nonce`: der Nonce der Anfrage für das Stilelement (die Richtlinie erlaubt keine ungekennzeichneten Stile). */
export function reinstallHtml(nonce?: string): string {
  const paragraphs = [...REINSTALL_TEXT.de, ...REINSTALL_TEXT.en].map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  return (
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>SchrauberOS</title>` +
    `<style${nonce ? ` nonce="${nonce}"` : ""}>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:2rem 1rem}main{max-width:40rem;margin:0 auto}</style></head>` +
    `<body><main data-status="reinstall"><h1>${escapeHtml(REINSTALL_TEXT.title)}</h1>${paragraphs}</main></body></html>`
  );
}
