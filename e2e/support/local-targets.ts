import type { APIRequestContext } from "@playwright/test";

/**
 * Die Zielsperre der Anwendung (E-Mail-Versand, Webhooks, Überwachung) lässt den eigenen Rechner nie zu – die Browser-CI stellt ihre kleinen Empfänger aber auf 127.0.0.1 auf.
 * Der Testserver (nur mit `SCHRAUBEROS_E2E=1` und `NODE_TEST_CONTEXT`, siehe e2e/start-server.mjs) öffnet die Sperre über die Testseite `/e2e-fault/loopback`; ohne Testmodus ist sie 404.
 */
export async function allowLoopbackTargets(request: APIRequestContext): Promise<void> {
  const response = await request.get("/e2e-fault/loopback");
  if (response.status() !== 200 || !(await response.text()).includes('data-e2e="loopback"')) throw new Error(`Loopback-Ziele ließen sich nicht freigeben (Status ${response.status()}): läuft der Server über e2e/start-server.mjs?`);
}
