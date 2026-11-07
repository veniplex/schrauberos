import { endOfDay } from "./keychain";

/** So viele Tage vor dem Ablauf der Beglaubigung warnt die Update-Seite (der Starter prüft den Ablauf nie, die App beim Installieren). */
export const ENDORSEMENT_WARN_DAYS = 90;

/** Volle Tage bis zum Ende des Gültigkeitstages (UTC); negativ, wenn abgelaufen. */
export const daysUntil = (validUntil: string, now: number = Date.now()): number => Math.floor((endOfDay(validUntil) - now) / 86_400_000);

/** Verbleibende Tage, wenn die Warnung angezeigt werden soll (abgelaufen oder bald ablaufend), sonst `null`. */
export const endorsementWarning = (validUntil: string | undefined, now?: number): number | null => {
  if (!validUntil) return null;
  const days = daysUntil(validUntil, now);
  return days < ENDORSEMENT_WARN_DAYS ? days : null;
};
