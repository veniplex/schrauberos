import "server-only";
import { parseOpeningHours } from "@/lib/opening-hours";
import type { SetupCheckDef } from "@/modules/types";
import { readHolidayConfig } from "@/server/holidays";
import { getWorkshop } from "@/server/workshop";

/** Ist das Werkstattprofil ausgefüllt? Anschrift (Straße, PLZ, Ort) und mindestens ein Kontaktweg (Telefon oder E-Mail) – der Name allein ist schon beim Einrichten da. */
export function profileComplete(w: { street: string | null; zip: string | null; city: string | null; phone: string | null; email: string | null }): boolean {
  return [w.street, w.zip, w.city].every((v) => !!v?.trim()) && !!(w.phone?.trim() || w.email?.trim());
}

/** Wurden Öffnungszeiten je festgelegt? Ein leeres Objekt heißt „nie konfiguriert“ (die Anwendung rechnet dann mit Standardzeiten, siehe `parseOpeningHours`). */
export function hoursConfigured(raw: string | null | undefined): boolean {
  try {
    const parsed = JSON.parse(raw || "{}");
    return !!parsed && typeof parsed === "object" && Object.keys(parsed).length > 0 && Object.values(parseOpeningHours(raw)).some((day) => day !== null);
  } catch {
    return false;
  }
}

/** Einrichtungsschritte der Einstellungen: Profil, Öffnungszeiten, HTTPS (Hinweis nach Systemstatus) und die Zwei-Faktor-Anmeldung der Administration (empfohlen). */
export const setupChecks: SetupCheckDef[] = [
  { id: "profile", feature: "admin.settings", permission: "settings.manage", labelKey: "settings.checklist.profile.label", hintKey: "settings.checklist.profile.hint", href: "/settings", order: 10, done: async () => profileComplete(await getWorkshop()) },
  { id: "hours", feature: "admin.settings", permission: "settings.manage", labelKey: "settings.checklist.hours.label", hintKey: "settings.checklist.hours.hint", href: "/settings", order: 11, done: async () => hoursConfigured((await getWorkshop()).openingHours) },
  { id: "holidays", feature: "admin.settings", permission: "settings.manage", labelKey: "settings.checklist.holidays.label", hintKey: "settings.checklist.holidays.hint", href: "/settings?tab=holidays", order: 12, recommended: true, done: async () => (await readHolidayConfig()).region !== "" },
  { id: "https", feature: "admin.settings", permission: "settings.manage", labelKey: "settings.checklist.https.label", hintKey: "settings.checklist.https.hint", href: "/settings?tab=security", order: 60, recommended: true, done: async ({ secure }) => secure },
  { id: "twoFactor", feature: "admin.settings", permission: "settings.manage", labelKey: "settings.checklist.twoFactor.label", hintKey: "settings.checklist.twoFactor.hint", href: "/account", order: 61, recommended: true, done: async ({ session }) => session.user.twoFactor },
];
