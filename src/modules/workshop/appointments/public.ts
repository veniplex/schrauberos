/**
 * Öffentliche Schnittstelle der Funktion workshop.appointments. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 */
export { AppointmentQuickStatus, type QuickStatusAppointment } from "./appointment-quick-status";
export { followVehicleOwner } from "./follow-owner";
export { STATUS_TONE } from "./status-tone";
