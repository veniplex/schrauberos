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
