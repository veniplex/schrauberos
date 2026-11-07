/**
 * Wird einmal beim Start des Servers aufgerufen. Der eigentliche Start (Sicherung vor Migrationen, Migrationen, Basisdaten, Zeitzone, Job-Runner) läuft **im Hintergrund**
 * (`src/server/startup-launch.ts`): Next wartet auf `register()`, bevor es auch nur eine Anfrage beantwortet – ein `await` hier ließe `/api/health` während einer langen
 * Migration ohne Antwort. Bis `startupState().status === "ready"` antwortet der Proxy (`proxy.ts`) auf alles außer `/api/health` mit 503.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { launchStartup } = await import("@/server/startup-launch");
  launchStartup();
}
