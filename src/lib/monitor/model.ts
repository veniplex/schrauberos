/**
 * Erreichbarkeits-Überwachung (F12) – die reine Logik ohne Netzwerk, Datenbank und Uhr (alles Zeitabhängige wird hineingereicht), vollständig getestet (`model.test.ts`).
 *
 * **Was gemessen wird:** eine TCP-Verbindung oder eine HTTP(S)-Anfrage (kein ICMP: der Container hat `cap_drop`). Gespeichert und angezeigt werden nur *Erreichbar ja/nein*, die Latenz in
 * Millisekunden, die **Statusklasse** und der Zeitpunkt – nie ein Antworttext, nie Kopfzeilen.
 *
 * **Entprellung:** Ein Ziel gilt erst nach `DOWN_AFTER` (2) aufeinanderfolgenden Fehlschlägen als „Ab“; bis dahin bleibt der bisherige Zustand stehen (ein einzelner verlorener Versuch ist kein Ausfall).
 * Nach einem Fehlschlag wird nach `RETRY_SECONDS` (60 s) erneut geprüft, nicht erst nach dem vollen Intervall.
 *
 * **Veraltet:** Eine Messung, die älter als `STALE_INTERVALS` (3) Intervalle ist, gilt als veraltet – der Status ist dann „unbekannt“, nie grün (z. B. der Job läuft nicht).
 */

export const MONITOR_KINDS = ["tcp", "http", "https"] as const;
export type MonitorKind = (typeof MONITOR_KINDS)[number];
export const MONITOR_METHODS = ["HEAD", "GET"] as const;
export type MonitorMethod = (typeof MONITOR_METHODS)[number];

/** Grenzen (Missbrauchsschutz: die Überwachung ist eine Verbindungsmaschine ins eigene Netz) */
export const MAX_TARGETS = 100;
export const MAX_CONCURRENT_CHECKS = 4;
export const CHECK_TIMEOUT_MS = 5_000;
export const MIN_INTERVAL_SECONDS = 60;
export const DEFAULT_INTERVAL_SECONDS = 300;
export const MAX_INTERVAL_SECONDS = 86_400;
/** Auswahl in der Oberfläche (Sekunden) */
export const INTERVAL_CHOICES = [60, 120, 300, 600, 900, 1800, 3600] as const;
export const DOWN_AFTER = 2;
export const RETRY_SECONDS = 60;
export const STALE_INTERVALS = 3;

/** Aufbewahrung: Rohwerte 7 Tage, danach Stundenwerte bis 30 Tage, Zustandswechsel 90 Tage */
export const RAW_KEEP_DAYS = 7;
export const HOURLY_KEEP_DAYS = 30;
export const EVENT_KEEP_DAYS = 90;

/** Statusklassen einer Messung (Schlüssel unter `network.monitor.classes.*`) */
export const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx", "open", "tlsWarning", "timeout", "refused", "unreachable", "dns", "tls", "blocked", "protocol", "error"] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

export type TargetState = "unknown" | "up" | "warn" | "down";

/** Ergebnis einer Messung: `ok` = erreichbar; `warn` = erreichbar, aber auffällig (Zertifikat, Serverfehler 5xx) */
export type ProbeOutcome = { ok: boolean; warn: boolean; latencyMs: number | null; statusClass: StatusClass };

/** Bewertung einer HTTP-Statuszeile: 2xx/3xx/4xx = Server antwortet (erreichbar), 5xx = erreichbar, aber Fehler (Warnung), alles andere ist keine gültige Antwort. */
export function classifyHttpStatus(status: number): { ok: boolean; warn: boolean; statusClass: StatusClass } {
  if (status >= 200 && status < 300) return { ok: true, warn: false, statusClass: "2xx" };
  if (status >= 300 && status < 400) return { ok: true, warn: false, statusClass: "3xx" };
  if (status >= 400 && status < 500) return { ok: true, warn: false, statusClass: "4xx" };
  if (status >= 500 && status < 600) return { ok: true, warn: true, statusClass: "5xx" };
  return { ok: false, warn: false, statusClass: "protocol" };
}

export type StateStep = { state: TargetState; failStreak: number };
export type StateChange = StateStep & {
  /** Zustandswechsel, der ein Ereignis wird: Ausfall (in „Ab“ gewechselt) oder Wiederkehr (aus „Ab“ zurück) */
  event: "down" | "up" | null;
  /** Wartezeit bis zur nächsten Prüfung in Sekunden */
  nextInSeconds: number;
};

/** Der nächste Zustand nach einer Messung (Entprellung). Rein: gleiche Eingabe, gleiches Ergebnis. */
export function nextState(previous: StateStep, outcome: Pick<ProbeOutcome, "ok" | "warn">, intervalSeconds: number): StateChange {
  if (outcome.ok) {
    const state: TargetState = outcome.warn ? "warn" : "up";
    return { state, failStreak: 0, event: previous.state === "down" ? "up" : null, nextInSeconds: intervalSeconds };
  }
  const failStreak = Math.min(previous.failStreak + 1, 1_000);
  if (failStreak >= DOWN_AFTER) return { state: "down", failStreak, event: previous.state === "down" ? null : "down", nextInSeconds: previous.state === "down" ? intervalSeconds : Math.min(intervalSeconds, RETRY_SECONDS) };
  // Erster Fehlschlag: der bisherige Zustand bleibt (erst die zweite Messung entscheidet), nach kurzer Zeit wird nachgeprüft
  return { state: previous.state, failStreak, event: null, nextInSeconds: Math.min(intervalSeconds, RETRY_SECONDS) };
}

/** Ist die letzte Messung veraltet (nie gemessen oder älter als `STALE_INTERVALS` Intervalle)? */
export function isStale(lastCheckAt: Date | null, intervalSeconds: number, now: Date): boolean {
  return lastCheckAt === null || now.getTime() - lastCheckAt.getTime() > STALE_INTERVALS * intervalSeconds * 1000;
}

/** Anzeigezustand eines Ziels: gemessen und frisch → der Zustand; sonst „unknown“ mit Hinweis, ob die Messung veraltet ist (es gab schon einmal eine). */
export type TargetView = { state: TargetState; stale: boolean };
export function viewOf(target: { state: string; lastCheckAt: Date | null; intervalSec: number }, now: Date): TargetView {
  const known = target.state === "up" || target.state === "warn" || target.state === "down";
  if (!known || target.lastCheckAt === null) return { state: "unknown", stale: false };
  return isStale(target.lastCheckAt, target.intervalSec, now) ? { state: "unknown", stale: true } : { state: target.state as TargetState, stale: false };
}

export type LinkState = "online" | "degraded" | "offline" | "unknown";
export type DeviceStatus = { state: LinkState; latencyMs: number | null; checkedAt: Date | null; stale: boolean; targets: number };

/**
 * Zustand eines Geräts aus seinen Zielen: alle erreichbar → Online, alle „Ab“ → Offline, gemischt oder Warnung → eingeschränkt. Nur frische Messungen zählen; gibt es keine, ist der Zustand
 * unbekannt (`stale`: es gab Messungen, sie sind aber zu alt). Ohne Ziele: unbekannt, nie ein erfundener Wert.
 */
export function deviceStatus(
  targets: ReadonlyArray<{ state: string; lastCheckAt: Date | null; lastLatencyMs: number | null; intervalSec: number }>,
  now: Date,
): DeviceStatus {
  const views = targets.map((t) => ({ target: t, view: viewOf(t, now) }));
  const fresh = views.filter((v) => v.view.state !== "unknown");
  const checkedAt = targets.reduce<Date | null>((latest, t) => (t.lastCheckAt && (!latest || t.lastCheckAt > latest) ? t.lastCheckAt : latest), null);
  if (fresh.length === 0) return { state: "unknown", latencyMs: null, checkedAt, stale: views.some((v) => v.view.stale), targets: targets.length };
  const down = fresh.filter((v) => v.view.state === "down").length;
  const warn = fresh.filter((v) => v.view.state === "warn").length;
  const state: LinkState = down === fresh.length ? "offline" : down > 0 || warn > 0 ? "degraded" : "online";
  const latencies = fresh.filter((v) => v.view.state !== "down" && v.target.lastLatencyMs !== null).map((v) => v.target.lastLatencyMs as number);
  const latencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  return { state, latencyMs, checkedAt, stale: false, targets: targets.length };
}

/* ───────────── Verdichtung ───────────── */

export type SampleLike = { at: Date; ok: boolean; latencyMs: number | null };
export type HourBucket = { hour: Date; checks: number; failures: number; latencySumMs: number; latencyCount: number; latencyMaxMs: number | null };

/** Beginn der (UTC-)Stunde, in die der Zeitpunkt fällt */
export const hourStart = (at: Date): Date => new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);

/** Fasst Rohwerte zu Stundenwerten zusammen (nach Stunde aufsteigend). */
export function compactSamples(samples: readonly SampleLike[]): HourBucket[] {
  const buckets = new Map<number, HourBucket>();
  for (const s of samples) {
    const hour = hourStart(s.at);
    let b = buckets.get(hour.getTime());
    if (!b) buckets.set(hour.getTime(), (b = { hour, checks: 0, failures: 0, latencySumMs: 0, latencyCount: 0, latencyMaxMs: null }));
    b.checks += 1;
    if (!s.ok) b.failures += 1;
    if (s.ok && s.latencyMs !== null) {
      b.latencySumMs += s.latencyMs;
      b.latencyCount += 1;
      b.latencyMaxMs = Math.max(b.latencyMaxMs ?? 0, s.latencyMs);
    }
  }
  return [...buckets.values()].sort((a, b) => a.hour.getTime() - b.hour.getTime());
}

/** Verfügbarkeit in Prozent (eine Nachkommastelle); `null` ohne Messungen */
export function availability(checks: number, failures: number): number | null {
  return checks > 0 ? Math.round(((checks - failures) / checks) * 1000) / 10 : null;
}
