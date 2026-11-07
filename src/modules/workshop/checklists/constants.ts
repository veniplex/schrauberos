/** Art eines Punktes (Beschriftung `checklists.itemTypes.*`); die Werte sind API-Vertrag. */
export const ITEM_TYPES = ["check", "measure", "torque", "choice", "text", "photo"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Punkte, die eine Zahl tragen (Messwert, Drehmoment in Nm). */
export const NUMERIC_TYPES: readonly ItemType[] = ["measure", "torque"];

/** Kundenunterschrift beim Abschluss: keine, möglich oder Pflicht. */
export const SIGNATURE_MODES = ["none", "optional", "required"] as const;
export type SignatureMode = (typeof SIGNATURE_MODES)[number];

/** Zustand einer Checkliste. Abgeschlossene sind unveränderlich. */
export const CHECKLIST_STATUSES = ["open", "completed", "discarded"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/** Die mitgelieferten Vorlagen (`ChecklistTemplate.standardKey`); `intake` ist das Annahmeprotokoll. */
export const STANDARD_KEYS = ["intake", "oil", "tires", "hu"] as const;
export type StandardKey = (typeof STANDARD_KEYS)[number];

/** Ereignisse im Verlauf einer Checkliste. */
export const EVENT_KINDS = ["created", "completed", "reopened", "discarded"] as const;

export const MAX_ITEMS = 80;
export const LABEL_MAX = 200;
export const HINT_MAX = 300;
export const OPTION_MAX = 60;
export const MAX_OPTIONS = 20;
export const TEXT_MAX = 1000;
/** Obergrenze eines Messwerts (Betrag): schützt vor Unsinn wie 1e300 */
export const NUMBER_LIMIT = 1_000_000;
/** Höchstens so viele offene Checklisten je Fahrzeug bzw. Auftrag (schützt die Seite vor versehentlichem Vervielfachen). */
export const MAX_OPEN_PER_OWNER = 40;
