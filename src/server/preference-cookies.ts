import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, THEME_COOKIE } from "@/i18n/config";

/** Cookies der persönlichen Anzeigeeinstellungen (Sprache, Design) – Transport-Teil der Aktionen in `actions/preferences.ts`. */
const cookieOpts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };

export async function writeLocaleCookie(locale: string): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, cookieOpts);
}

export async function writeThemeCookie(theme: string): Promise<void> {
  (await cookies()).set(THEME_COOKIE, theme, cookieOpts);
}
