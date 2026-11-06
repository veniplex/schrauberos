"use server";

import { z } from "zod";
import { isLocale } from "@/i18n/config";
import { THEMES, type Theme } from "@/lib/constants";
import { writeLocaleCookie, writeThemeCookie } from "@/server/preference-cookies";
import { defineAction, defineOperation } from "@/server/operations";

/**
 * Persönliche Anzeigeeinstellungen: Sprache und Design. Gespeichert im Benutzerprofil (Operation) und als Cookie (Adapter, `onSuccess`):
 * Das Cookie gilt auch vor der nächsten Anmeldung. Jede angemeldete Person darf – auch mit ausstehendem Passwortwechsel (die Kontoseite
 * bietet beides an).
 */
const setLocaleOperation = defineOperation({
  name: "preferences.setLocale",
  permission: "authenticated",
  allowPasswordChange: true,
  input: z.object({ locale: z.string().refine(isLocale, { error: "validation.invalid" }) }),
  audit: false,
  auditReason: "Persönliche Anzeigeeinstellung ohne Auswirkung auf Daten oder Rechte anderer",
  run: async ({ input, principal, tx }) => {
    await tx.user.update({ where: { id: principal.user.id }, data: { locale: input.locale } });
    return { locale: input.locale };
  },
});

/** Persönliche Sprache setzen (Aufruf mit Formularfeld `locale`). */
export const setLocale = defineAction(setLocaleOperation, { revalidate: [["/", "layout"]], onSuccess: ({ locale }) => writeLocaleCookie(locale) });

const setThemeOperation = defineOperation({
  name: "preferences.setTheme",
  permission: "authenticated",
  allowPasswordChange: true,
  input: z.object({ theme: z.string().refine((value): value is Theme => (THEMES as readonly string[]).includes(value), { error: "validation.invalid" }) }),
  audit: false,
  auditReason: "Persönliche Anzeigeeinstellung ohne Auswirkung auf Daten oder Rechte anderer",
  run: async ({ input, principal, tx }) => {
    await tx.user.update({ where: { id: principal.user.id }, data: { theme: input.theme } });
    return { theme: input.theme };
  },
});

/** Persönliches Design setzen: system | light | dark (Aufruf mit Formularfeld `theme`). */
export const setTheme = defineAction(setThemeOperation, { revalidate: [["/", "layout"]], onSuccess: ({ theme }) => writeThemeCookie(theme) });
