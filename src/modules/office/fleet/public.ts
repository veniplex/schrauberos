/**
 * Öffentliche Schnittstelle der Funktion office.fleet. Andere Funktionen importieren NUR aus dieser Datei (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 *
 *  - `fleetDeadlines`: Hauptuntersuchung und Service der Firmenfahrzeuge als Fristen (Kalender-Abo, F10) – nur mit `fleet.view`.
 */
export { fleetDeadlines, type FleetDeadline } from "./queries";
