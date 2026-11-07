/** Herkunft eines Zeiteintrags: gestempelt oder nachgetragen (mit Begründung). */
export const ENTRY_SOURCES = ["stamp", "manual"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** Art einer Korrektur im Verlauf: geändert, storniert, nachgetragen. */
export const CORRECTION_KINDS = ["edit", "void", "create"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

/** Sollzeit je Arbeitstag, wenn nichts eingestellt ist (8 Stunden). */
export const DEFAULT_DAILY_TARGET_MINUTES = 480;
export const MIN_DAILY_TARGET_MINUTES = 60;
export const MAX_DAILY_TARGET_MINUTES = 720;

/** Ein Eintrag dauert höchstens einen Tag; ein Nachtrag liegt höchstens so weit in der Zukunft (Uhrenabweichung). */
export const MAX_ENTRY_MINUTES = 24 * 60;
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Pflicht-Begründung einer Korrektur: mindestens so viele Zeichen. */
export const MIN_REASON_LENGTH = 5;

/** Steuersatz der übernommenen Arbeitspositionen (19 %); bei Kleinunternehmern rechnet der Auftrag ohnehin ohne Steuer. */
export const LABOR_TAX_BP = 1900;
/** `refType` der aus Zeiten entstandenen Auftragspositionen (`refId` = Zeiteintrag). */
export const TIME_REF_TYPE = "time";

/**
 * Schwellen der Pausen- und Ruhezeit-Hinweise, an das Arbeitszeitgesetz angelehnt (§ 3 Höchstarbeitszeit, § 4 Ruhepausen, § 5 Ruhezeit). **Hinweise, keine Rechtsberatung und keine Sperre:** Sie
 * ersetzen weder eine arbeitsrechtliche Prüfung noch tarifliche oder betriebliche Regeln. Alle Werte in Minuten.
 */
export const HINT_RULES = {
  /** mehr als 6 Stunden Arbeit: mindestens 30 Minuten Pause */
  breakAfter: 6 * 60,
  breakNeeded: 30,
  /** mehr als 9 Stunden Arbeit: mindestens 45 Minuten Pause */
  longBreakAfter: 9 * 60,
  longBreakNeeded: 45,
  /** mehr als 10 Stunden Arbeit an einem Tag */
  maxDay: 10 * 60,
  /** zwischen zwei Arbeitstagen mindestens 11 Stunden Ruhezeit */
  rest: 11 * 60,
  /** ein Eintrag, der länger als 16 Stunden läuft, wurde vermutlich nicht beendet */
  forgotten: 16 * 60,
} as const;
