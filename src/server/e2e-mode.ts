/**
 * Browser-CI-Modus (`SCHRAUBEROS_E2E=1`, gesetzt nur von e2e/start-server.mjs): schaltet die Testseiten `/e2e-state/…` und `/e2e-fault/…` frei, die
 * Fehler- und Hinweiszustände absichtlich erzeugen. Im Betrieb ist die Variable nie gesetzt – die Seiten antworten dort wie jede unbekannte Adresse (404).
 */
export const e2eMode = () => process.env.SCHRAUBEROS_E2E === "1";

/** Umgebungsvariablen, die nur Tests setzen: `SCHRAUBEROS_E2E` (Testseiten) und `NODE_TEST_CONTEXT` (öffnet die Zielsperre für Loopback in Tests). */
const TEST_VARIABLES = ["SCHRAUBEROS_E2E", "NODE_TEST_CONTEXT"] as const;

/**
 * Welche Test-Variablen sind im **echten Betrieb** (Container mit Starter: `APP_UPDATER=1`) gesetzt? Beide sind Umgebungsvariablen des Betreibers (von außen nicht setzbar), aber ein versehentliches
 * `SCHRAUBEROS_E2E=1` in einer Compose-Datei bliebe sonst still (Z6-2 N8). Der Start meldet sie im Log, der Systemstatus als Fehler. Die Browser-CI startet den Server ohne `APP_UPDATER` und ist nicht betroffen.
 */
export function testVariablesInProduction(env: Record<string, string | undefined> = process.env): string[] {
  return env.APP_UPDATER === "1" ? TEST_VARIABLES.filter((name) => (env[name] ?? "") !== "") : [];
}
