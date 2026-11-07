import "server-only";
import { WindowLimiter } from "@/lib/api/limit";

/**
 * Zustand der Drosselung des Kalender-Abos im Prozess (Logik: `lib/api/limit.ts`; Muster wie `server/api/state.ts`). Gezählt werden **nur ungültige Aufrufe** (unbekanntes, abgelaufenes,
 * widerrufenes Token, Besitzer gesperrt): zuerst global, je Adresse nur hinter dem Reverse-Proxy (sonst wäre der Header fälschbar). Ein gültiges Token kommt nie hierher und wird von einer Flut
 * ungültiger Aufrufe nicht ausgebremst. Eigene Zähler (nicht die der API): Fehlversuche am Feed sollen Programmzugriffe nicht sperren und umgekehrt.
 */
export const feedRuntime = { now: (): number => Date.now() };

/** Grenzen der Fehlversuche je Minute (Tests ändern sie). */
export const feedLimits = { failuresGlobal: 120, failuresPerIp: 30 };

const now = () => feedRuntime.now();

function create() {
  return {
    failuresGlobal: new WindowLimiter({ windowMs: 60_000, maxKeys: 1, now }),
    failuresPerIp: new WindowLimiter({ windowMs: 60_000, maxKeys: 5_000, now }),
  };
}

const globalForFeed = globalThis as unknown as { __feedLimiters?: ReturnType<typeof create> };
export const feedLimiters = (globalForFeed.__feedLimiters ??= create());

/** Für Tests: alles auf Anfang. */
export function resetFeedLimiters(): void {
  feedLimits.failuresGlobal = 120;
  feedLimits.failuresPerIp = 30;
  Object.assign(feedLimiters, create());
}
