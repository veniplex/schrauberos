/**
 * Zustand des App-Starts (leichtgewichtig, ohne Datenbank-Imports, damit Layout und Health-Endpoint ihn lesen können).
 *  - `starting`: Sicherung vor Migrationen und Migrationen laufen noch (`instrumentation.ts` startet sie im Hintergrund, `register()` wartet nicht darauf – Next
 *    beantwortet vor dessen Ende gar keine Anfrage). `/api/health` antwortet 503 `{ status: "starting" }` (der Launcher verlängert dann seine Frist), und `proxy.ts` beantwortet
 *    alles andere mit 503, damit keine Anfrage eine noch nicht migrierte Datenbank erreicht;
 *  - `ready`: alles bereit,
 *  - `failed`: Start gescheitert – der Prozess beendet sich (Launcher: Rückfall auf die Vorversion),
 *  - `reinstall`: fremde Migrationshistorie (Volume einer nicht verträglichen Version): die App bleibt bewusst am Leben, fasst die
 *    Datenbank nicht an und zeigt „Neuinstallation nötig“ – ein Absturz würde nur eine Neustart-Schleife erzeugen.
 */
export type StartupState = { status: "starting" | "ready" | "failed" | "reinstall"; error?: string };

const globalForStartup = globalThis as unknown as { __startup?: StartupState };
export const startupState = (): StartupState => (globalForStartup.__startup ??= { status: "starting" });
