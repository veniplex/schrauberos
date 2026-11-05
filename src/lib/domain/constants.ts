// Zustandswerte, die in der Datenbank als Strings gespeichert werden (portabel SQLite/Postgres).
// Beschriftungen stehen in src/i18n/messages/* unter `enums.*`.

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "in_progress",
  "done",
  "cancelled",
  "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const TIRE_SEASONS = ["summer", "winter", "allseason"] as const;
export type TireSeason = (typeof TIRE_SEASONS)[number];

export const TIRE_SET_STATUSES = ["stored", "mounted", "disposed"] as const;
export type TireSetStatus = (typeof TIRE_SET_STATUSES)[number];

export const RIM_TYPES = ["none", "steel", "alloy"] as const;
export type RimType = (typeof RIM_TYPES)[number];

export const TIRE_POSITIONS = ["FL", "FR", "RL", "RR", "SPARE"] as const;
export type TirePosition = (typeof TIRE_POSITIONS)[number];

export const TIRE_CONDITIONS = ["new", "good", "fair", "worn", "damaged"] as const;
export type TireCondition = (typeof TIRE_CONDITIONS)[number];

export const APPOINTMENT_KINDS = ["general", "tire_change"] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Fahrzeug-/Kundendaten können aus Fremdsystemen stammen. */
export const EXTERNAL_SOURCES = ["werbas"] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];
