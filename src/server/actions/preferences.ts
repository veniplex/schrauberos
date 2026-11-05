"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { isLocale, LOCALE_COOKIE, THEME_COOKIE } from "@/i18n/config";
import { THEMES, type Theme } from "@/lib/domain/constants";

const cookieOpts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };

/** Persönliche Sprache setzen (Cookie + Benutzerprofil, falls eingeloggt). */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, cookieOpts);
  const session = await getSession();
  if (session) await db.user.update({ where: { id: session.user.id }, data: { locale } });
  revalidatePath("/", "layout");
}

/** Persönliches Design setzen: system | light | dark. */
export async function setTheme(theme: string) {
  if (!(THEMES as readonly string[]).includes(theme)) return;
  (await cookies()).set(THEME_COOKIE, theme, cookieOpts);
  const session = await getSession();
  if (session) await db.user.update({ where: { id: session.user.id }, data: { theme: theme as Theme } });
  revalidatePath("/", "layout");
}
