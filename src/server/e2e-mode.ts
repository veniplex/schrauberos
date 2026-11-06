/**
 * Browser-CI-Modus (`SCHRAUBEROS_E2E=1`, gesetzt nur von e2e/start-server.mjs): schaltet die Testseiten `/e2e-state/…` und `/e2e-fault/…` frei, die
 * Fehler- und Hinweiszustände absichtlich erzeugen. Im Betrieb ist die Variable nie gesetzt – die Seiten antworten dort wie jede unbekannte Adresse (404).
 */
export const e2eMode = () => process.env.SCHRAUBEROS_E2E === "1";
