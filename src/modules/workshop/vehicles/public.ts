/**
 * Öffentliche Schnittstelle der Funktion workshop.vehicles. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 */
export { VehiclePicker, type VehicleOption } from "./vehicle-picker";
export { toVehicleOption } from "./vehicle-option";
export { vehicleLabels, vehicleRef, vehicleTextWhere } from "./queries";
