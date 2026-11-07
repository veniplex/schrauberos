/**
 * Launcher: gehört zu jeder App-Version (liegt im Paket, nicht im Image) und läuft auf deren eigener Laufzeit.
 *
 * Dies ist nur die Verdrahtung mit der echten Umgebung (Prozess, Netzwerk, Zeit). Der Ablauf – Version prüfen, App starten,
 * Gesundheit abwarten, zurückrollen, Wiederherstellung einspielen – steht in `launcher.ts` und ist dort mit Fakes getestet.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { readAppliedMigrations, type MigrationDb } from "../lib/updates/compat";
import { positiveMs, probeHealth } from "../lib/updates/health";
import { databaseFile } from "../server/db-client-path";
import { createLauncher, DEFAULT_HEALTH_MAX_MS, type AppProcess, type LauncherDeps } from "./launcher";

const PORT = process.env.PORT ?? "3000";

const deps: LauncherDeps = {
  spawn: ({ command, args, cwd, env }): AppProcess => {
    const proc = spawn(command, args, { cwd, stdio: "inherit", env });
    let done = false;
    const exited = new Promise<number>((resolve) => {
      proc.on("exit", (code, signal) => {
        done = true;
        resolve(code ?? (signal ? 1 : 0));
      });
      proc.on("error", () => {
        done = true;
        resolve(1);
      });
    });
    return { exited, hasExited: () => done, kill: (signal) => void proc.kill(signal) };
  },
  health: () => probeHealth(PORT),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  log: (message) => console.log(`[launcher] ${message}`),
  // Nur lesend und erst bei Bedarf (Rückfall): better-sqlite3 liegt im Paket neben dem Launcher (kein Teil des esbuild-Pakets, daher über require aus dem Paketordner)
  appliedMigrations: () => {
    try {
      const Database = createRequire(path.join(process.cwd(), "launcher.mjs"))("better-sqlite3") as new (file: string, options: { readonly: boolean; fileMustExist: boolean }) => MigrationDb;
      return readAppliedMigrations(databaseFile(), (file) => new Database(file, { readonly: true, fileMustExist: true }));
    } catch {
      return null;
    }
  },
};

const launcher = createLauncher(
  {
    own: path.resolve(process.cwd()),
    builtin: path.resolve(process.env.BUILTIN_DIR ?? "/app"),
    port: PORT,
    healthTimeoutMs: positiveMs(process.env.LAUNCHER_HEALTH_TIMEOUT_MS, 90_000),
    healthMaxMs: positiveMs(process.env.LAUNCHER_HEALTH_MAX_MS, DEFAULT_HEALTH_MAX_MS),
    env: process.env,
    execPath: process.execPath,
  },
  deps,
);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (launcher.requestStop(signal)) process.exit(0);
  });
}

launcher.run().then(
  (code) => process.exit(code),
  (error) => {
    console.error("[launcher] Unerwarteter Fehler", error);
    process.exit(1);
  },
);
