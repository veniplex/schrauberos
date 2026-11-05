import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, THEME_COOKIE, type Locale } from "./config";
import { de, type Messages } from "./messages/de";
import { en } from "./messages/en";
import { createTranslator, type Translator } from "./translate";
import { THEMES, type Theme } from "@/lib/domain/constants";

const dictionaries: Record<Locale, Messages> = { de, en };

export const getLocale = cache(async (): Promise<Locale> => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
});

export const getMessages = cache(async (): Promise<Messages> => dictionaries[await getLocale()]);

/** Übersetzer für Server Components & Actions. */
export const getI18n = cache(async (): Promise<Translator> => {
  const locale = await getLocale();
  return createTranslator(locale, dictionaries[locale]);
});

export const getTheme = cache(async (): Promise<Theme> => {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "system";
});
