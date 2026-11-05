export const LOCALES = ["de", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "so_locale";
export const THEME_COOKIE = "so_theme";

export const LOCALE_LABELS: Record<Locale, string> = { de: "Deutsch", en: "English" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** BCP-47-Tag für Intl (Datums-/Zahlenformate). */
export const INTL_LOCALE: Record<Locale, string> = { de: "de-DE", en: "en-GB" };
