/**
 * Zustellplan der Webhooks (reine Logik, getestet): Zustände, Wartezeiten, Grenzen.
 *
 *  - **Wartezeiten** nach einem Fehlversuch (n = Nummer des gescheiterten Versuchs): 1 min, 5 min, 15 min, 30 min, 1 h, 2 h, 3 h, 4 h, 6 h, 6 h, 6 h. Nach dem 12. Versuch gilt die Zustellung als
 *    **aufgegeben** (Zustand `failed`, im Zustellprotokoll sichtbar, mit „Erneut zustellen“ wieder aufnehmbar) – insgesamt rund 29 Stunden.
 *  - **410 Gone** beendet die Zustellung sofort (`gone`) und schaltet das Ziel aus: Der Empfänger hat gesagt, dass es die Adresse nicht mehr gibt.
 *  - **Aufbewahrung:** Zustellprotokoll 30 Tage; Zustellungen an ein ausgeschaltetes Ziel werden bis zu 14 Tage zurückgestellt (`held`), danach verworfen.
 */
export const DELIVERY_STATUSES = ["pending", "held", "sent", "failed", "gone"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const MAX_ATTEMPTS = 12;
/** Wartezeit in Sekunden nach dem n-ten gescheiterten Versuch (1-basiert); darüber hinaus die letzte. */
const RETRY_SECONDS = [60, 300, 900, 1800, 3600, 7200, 10800, 14400, 21600] as const;

export const retryDelayMs = (failedAttempt: number): number => 1000 * RETRY_SECONDS[Math.min(Math.max(failedAttempt, 1), RETRY_SECONDS.length) - 1];

export const KEEP_LOG_DAYS = 30;
export const HOLD_DAYS = 14;
/** Mehr zurückgestellte Zustellungen je Ziel gibt es nicht (Ziel lange ausgeschaltet, viele Ereignisse). */
export const MAX_HELD_PER_WEBHOOK = 500;
export const MAX_WEBHOOKS = 20;
/** Zeitlimit eines Versuchs und Obergrenzen der Verbindung. */
export const ATTEMPT_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 8 * 1024;
export const GLOBAL_CONCURRENCY = 4;
/** Eine übernommene Zustellung gehört dem Läufer so lange; danach darf sie ein anderer übernehmen (Absturz mitten im Versuch). */
export const CLAIM_LEASE_MS = 2 * 60_000;

/** Fehlercodes eines Versuchs (kein Text des Empfängers, nie Teile der Antwort). */
export const DELIVERY_ERRORS = ["http", "redirect", "dns", "forbiddenHost", "connect", "tls", "timeout", "reset", "config", "secret", "restricted"] as const;
export type DeliveryError = (typeof DELIVERY_ERRORS)[number];

/** Was folgt auf eine Antwort mit diesem Statuscode? */
export function classifyStatus(status: number): "sent" | "gone" | "redirect" | "retry" {
  if (status >= 200 && status < 300) return "sent";
  if (status === 410) return "gone";
  if (status >= 300 && status < 400) return "redirect";
  return "retry";
}
