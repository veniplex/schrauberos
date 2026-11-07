/**
 * Öffentliche Schnittstelle der Funktion workshop.vehicles. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 * Client-Komponenten importieren stattdessen aus `client.ts` (nur client-sichere Teile; `public.ts` bringt Abfragen mit).
 */
export { VehiclePicker, toVehicleOption, type VehicleOption } from "./client";
export { vehicleDeadlines, vehicleInspectionOverview, vehicleLabels, vehicleRef, vehicleTextWhere, type InspectionMonth, type VehicleDeadline, type VehicleInspectionOverview } from "./queries";
