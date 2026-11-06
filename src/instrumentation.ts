/** Wird einmal beim Start des Servers aufgerufen: Datenbank vorbereiten (Migrationen, Basisdaten, Zeitzone, Backup-Plan). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startApp } = await import("@/server/startup");
  await startApp();
}
