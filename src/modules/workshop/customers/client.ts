/**
 * Client-sichere Schnittstelle der Funktion workshop.customers: nur reine Hilfsfunktionen und Typen, nichts mit Datenbank oder `server-only`.
 * Client-Komponenten anderer Funktionen importieren aus dieser Datei (nie aus `public.ts`, das Abfragen mitbringt und Server-Code ins Browserbündel zöge).
 * `src/architecture.test.ts` („Client-Bündel“) erzwingt das.
 */
export { customerDisplayName } from "./domain";
