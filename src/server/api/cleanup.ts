import "server-only";
import { pruneIdempotency } from "./idempotency";
import { pruneApiTokens } from "./tokens";

const DAY_MS = 24 * 60 * 60 * 1000;
const globalForCleanup = globalThis as unknown as { __lastApiTokenPrune?: number };

/**
 * Aufräumen der API-Daten (Job `platform.api-cleanup` des Job-Runners, siehe `server/jobs/platform.ts`): abgelaufene Idempotenz-Schlüssel bei jedem Lauf (indizierte Abfrage), Tokens, die seit
 * mehr als 90 Tagen abgelaufen oder widerrufen sind, höchstens einmal am Tag. Liefert die Anzahl gelöschter Zeilen.
 */
export async function runApiCleanup(now = Date.now()): Promise<number> {
  let removed = await pruneIdempotency(now);
  if (globalForCleanup.__lastApiTokenPrune === undefined || now - globalForCleanup.__lastApiTokenPrune >= DAY_MS) {
    removed += await pruneApiTokens(now);
    globalForCleanup.__lastApiTokenPrune = now; // erst nach erfolgreichem Lauf: ein Fehler verschiebt das Aufräumen nicht um einen Tag
  }
  return removed;
}
