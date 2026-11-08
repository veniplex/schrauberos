import { describeError } from "@/lib/log-safe";

/**
 * Startet den App-Start (`startApp`) **im Hintergrund** – leichtgewichtig, ohne Datenbank-Imports (testbar).
 *
 * Warum nicht `await startApp()` in `register()`: Next wartet vor der ersten Anfrage auf `register()` (`next-server.js`: `prepareImpl` →
 * `runInstrumentationHookIfAvailable`; `start-server.js`: `requestListener` wartet auf `handlersPromise`). Der Server nimmt zwar schon Verbindungen an, beantwortet
 * aber **keine** Anfrage – auch `/api/health` nicht. Der Launcher sähe bei einer langen Migration nur Zeitüberschreitungen und nie ein „starting“.
 * Deshalb kehrt `register()` sofort zurück: `/api/health` antwortet 503 `starting`, und `proxy.ts` beantwortet **alles andere** mit 503, bis der Zustand
 * `ready` ist – so erreicht keine Anfrage eine noch nicht migrierte Datenbank (Seiten, Server Actions, Route Handler).
 */
export type StartDeps = {
  /** Lädt und führt den Start aus (echt: `import("@/server/startup")` → `startApp()`); `startApp` fängt eigene Fehler selbst ab. */
  run(): Promise<void>;
  /** Beenden des Prozesses (echt: `process.exit`) */
  exit(code: number): void;
  log(message: string, error: unknown): void;
};

/** Kehrt sofort zurück; liefert das Versprechen des Starts (nur für Tests – im Betrieb nicht abwarten). */
export function startInBackground(deps: StartDeps): Promise<void> {
  return Promise.resolve()
    .then(() => deps.run())
    .catch((error) => {
      // `startApp` beendet den Prozess bei einem Startfehler selbst; hierher kommt nur, wer davor scheitert (z. B. Import) – nie als „starting“ hängen bleiben
      deps.log("[start] Start fehlgeschlagen:", error);
      deps.exit(1);
    });
}

/** Der echte Start (von `instrumentation.ts`): sofort zurück, Start läuft weiter. */
export function launchStartup(): void {
  void startInBackground({
    run: async () => (await import("@/server/startup")).startApp(),
    exit: (code) => process.exit(code),
    log: (message, error) => console.error(`${message} ${describeError(error)}`), // nur Art und Code, nie Meldung oder Stack
  });
}
