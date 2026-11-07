/**
 * Installierbare App (P3-5): Name und Farben des Manifests (`src/app/manifest.ts`) und der Kopfzeilen (`theme-color`).
 *
 * Die Farben sind **Werte der Design-Tokens** (`src/app/tokens.css`), als Hex ausgeschrieben, weil das Manifest keine `oklch()`/`light-dark()`-Werte kennt; `pwa.test.ts` rechnet sie
 * aus `tokens.css` nach – ändert jemand die Flächenfarben, schlägt der Test an. Das Manifest ist **statisch** (kein Datenbankzugriff: es liegt außerhalb des Proxys und wird auch
 * beantwortet, solange die Datenbank noch migriert), der Werkstattname steht deshalb nur im Titel der Seite, nicht im Manifest.
 */
export const PWA_NAME = "SchrauberOS";
export const PWA_DESCRIPTION = "Werkstatt-Dashboard";
/** Farbe der Statusleiste/Titelleiste: die Fläche der Kopfzeile (`--surface`). */
export const PWA_THEME_COLOR = { light: "#ffffff", dark: "#14191f" } as const;
/** Hintergrund des Startbildschirms beim Öffnen der installierten App (`--bg`; das Manifest kennt nur einen Wert). */
export const PWA_BACKGROUND_COLOR = "#f6f8fa";

/** Die Symbole unter `public/icons/` (erzeugt von `scripts/gen-pwa-icons.mjs`). */
export const PWA_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const;
export const PWA_APPLE_ICON = "/icons/apple-touch-icon.png";
