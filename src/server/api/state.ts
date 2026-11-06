import "server-only";
import { WindowLimiter } from "@/lib/api/limit";

/**
 * Zustand der API-Drosselung im Prozess (Logik: `src/lib/api/limit.ts`). Ein Prozess, eine Datenbank – Speicher im Prozess genügt:
 *  - `perToken`: Anfragen je Token und Minute (Grenze steht am Token),
 *  - `failures*`: **nur der Fehlerpfad** ungültiger Tokens. Gültige Tokens kommen nie hierher und werden von Fehlversuchen nicht ausgebremst.
 */
export const apiRuntime = { now: (): number => Date.now() };

/** Grenzen der Fehlversuche je Minute (Tests ändern sie). */
export const apiLimits = { failuresGlobal: 120, failuresPerIp: 30 };

const now = () => apiRuntime.now();

function create() {
  return {
    perToken: new WindowLimiter({ windowMs: 60_000, maxKeys: 5_000, now }),
    failuresGlobal: new WindowLimiter({ windowMs: 60_000, maxKeys: 1, now }),
    failuresPerIp: new WindowLimiter({ windowMs: 60_000, maxKeys: 5_000, now }),
  };
}

const globalForApi = globalThis as unknown as { __apiLimiters?: ReturnType<typeof create> };
export const apiLimiters = (globalForApi.__apiLimiters ??= create());

/** Für Tests: alles auf Anfang. */
export function resetApiLimiters(): void {
  apiLimits.failuresGlobal = 120;
  apiLimits.failuresPerIp = 30;
  Object.assign(apiLimiters, create());
}
