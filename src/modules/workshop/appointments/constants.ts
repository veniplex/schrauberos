export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "in_progress", "done", "cancelled", "no_show"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Schnellstatus („Starten“, „Fertig“) auf Karte, Liste und Übersicht – die beiden Schritte des Werkstattalltags; alles andere läuft über das Bearbeiten. */
export const QUICK_STATUSES = ["in_progress", "done"] as const;
export type QuickStatus = (typeof QUICK_STATUSES)[number];

/** "tire_change" markiert Reifenwechsel-Termine (Verknüpfung zur Reifenliste). */
export const APPOINTMENT_KINDS = ["general", "tire_change"] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];
