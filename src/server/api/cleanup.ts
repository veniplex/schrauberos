import "server-only";
import { pruneIdempotency } from "./idempotency";
import { pruneApiTokens } from "./tokens";

const DAY_MS = 24 * 60 * 60 * 1000;
const globalForCleanup = globalThis as unknown as { __lastApiTokenPrune?: number };

/**
 * Aufräumen der API-Daten (Scheduler, siehe `backup/scheduler.ts`): abgelaufene Idempotenz-Schlüssel bei jedem Lauf (indizierte Abfrage), Tokens, die seit
 * mehr als 90 Tagen abgelaufen oder widerrufen sind, höchstens einmal am Tag. Liefert die Anzahl gelöschter Zeilen.
 */
export async function runApiCleanup(now = Date.now()): Promise<number> {
  let removed = await pruneIdempotency(now);
  if (globalForCleanup.__lastApiTokenPrune === undefined || now - globalForCleanup.__lastApiTokenPrune >= DAY_MS) {
    globalForCleanup.__lastApiTokenPrune = now;
    removed += await pruneApiTokens(now);
  }
  return removed;
}
