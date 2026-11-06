/**
 * Zustand des App-Starts (leichtgewichtig, ohne Datenbank-Imports, damit Layout und Health-Endpoint ihn lesen können).
 *  - `starting`: Migrationen laufen noch, `/api/health` antwortet 503,
 *  - `ready`: alles bereit,
 *  - `failed`: Start gescheitert – der Prozess beendet sich (Launcher: Rückfall auf die Vorversion),
 *  - `reinstall`: fremde Migrationshistorie (Volume einer nicht verträglichen Version): die App bleibt bewusst am Leben, fasst die
 *    Datenbank nicht an und zeigt „Neuinstallation nötig“ – ein Absturz würde nur eine Neustart-Schleife erzeugen.
 */
export type StartupState = { status: "starting" | "ready" | "failed" | "reinstall"; error?: string };

const globalForStartup = globalThis as unknown as { __startup?: StartupState };
export const startupState = (): StartupState => (globalForStartup.__startup ??= { status: "starting" });
