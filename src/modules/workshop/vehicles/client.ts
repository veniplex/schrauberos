/**
 * Client-sichere Schnittstelle der Funktion workshop.vehicles: Auswahlfeld, Typen und reine Hilfsfunktionen – nichts mit Datenbank oder `server-only`.
 * Client-Komponenten anderer Funktionen importieren aus dieser Datei (nie aus `public.ts`, das Abfragen mitbringt und Server-Code ins Browserbündel zöge).
 * `src/architecture.test.ts` („Client-Bündel“) erzwingt das.
 */
export { VehiclePicker, type VehicleOption } from "./vehicle-picker";
export { toVehicleOption } from "./vehicle-option";
