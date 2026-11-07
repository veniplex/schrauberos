/**
 * Öffentliche Schnittstelle der Funktion workshop.appointments. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 */
export { AppointmentQuickStatus, type QuickStatusAppointment } from "./appointment-quick-status";
export { followVehicleOwner } from "./follow-owner";
export { UTILIZATION_MAX_BOOKINGS, utilizationSource, type UtilizationBooking, type UtilizationSource } from "./queries";
export { STATUS_TONE } from "./status-tone";
