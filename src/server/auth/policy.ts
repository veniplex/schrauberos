import "server-only";
import { db } from "@/server/db";

/**
 * Einstellungen der Anmelde-Richtlinie (Einstellungen → Sicherheit), in **einer** Abfrage gelesen (`getSession` fragt sie bei jeder Anfrage).
 *  - Leerlauf-Abmeldung: nach so vielen Stunden ohne Anfrage endet die Sitzung (0 = aus, Standard). Weil die letzte Nutzung nur etwa einmal pro Minute festgehalten
 *    wird, ist die Frist auf eine Minute genau.
 *  - Zwei-Faktor-Anmeldung für Administratoren verpflichtend (Standard aus): Wer Administrator ist und keinen zweiten Faktor eingerichtet hat, kommt erst nach der
 *    Einrichtung (unter „Mein Konto“) weiter – wie bei einem ausstehenden Passwortwechsel.
 */
export const IDLE_TIMEOUT_KEY = "auth.idleTimeoutHours";
export const REQUIRE_2FA_ADMINS_KEY = "auth.require2faAdmins";
/** Obergrenze der Leerlauf-Frist in Stunden (30 Tage) */
export const IDLE_TIMEOUT_MAX_HOURS = 720;

export type AuthPolicy = { idleTimeoutHours: number; requireTwoFactorForAdmins: boolean };

export function parseIdleHours(value: string | null | undefined): number {
  const hours = Number(value);
  return Number.isInteger(hours) && hours >= 0 && hours <= IDLE_TIMEOUT_MAX_HOURS ? hours : 0;
}

export async function authPolicy(): Promise<AuthPolicy> {
  const rows = await db.appSetting.findMany({ where: { key: { in: [IDLE_TIMEOUT_KEY, REQUIRE_2FA_ADMINS_KEY] } }, select: { key: true, value: true } });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return { idleTimeoutHours: parseIdleHours(byKey.get(IDLE_TIMEOUT_KEY)), requireTwoFactorForAdmins: byKey.get(REQUIRE_2FA_ADMINS_KEY) === "true" };
}
