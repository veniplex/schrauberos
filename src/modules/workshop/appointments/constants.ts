export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "in_progress", "done", "cancelled", "no_show"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** "tire_change" markiert Reifenwechsel-Termine (Verknüpfung zur Reifenliste). */
export const APPOINTMENT_KINDS = ["general", "tire_change"] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];
