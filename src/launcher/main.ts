/**
 * Launcher: gehört zu jeder App-Version (liegt im Paket, nicht im Image) und läuft auf deren eigener Laufzeit.
 *
 * Dies ist nur die Verdrahtung mit der echten Umgebung (Prozess, Netzwerk, Zeit). Der Ablauf – Version prüfen, App starten,
 * Gesundheit abwarten, zurückrollen, Wiederherstellung einspielen – steht in `launcher.ts` und ist dort mit Fakes getestet.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { createLauncher, type AppProcess, type LauncherDeps } from "./launcher";

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
  health: async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch {
      return null; // noch nicht bereit
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  log: (message) => console.log(`[launcher] ${message}`),
};

const launcher = createLauncher(
  {
    own: path.resolve(process.cwd()),
    builtin: path.resolve(process.env.BUILTIN_DIR ?? "/app"),
    port: PORT,
    healthTimeoutMs: Number(process.env.LAUNCHER_HEALTH_TIMEOUT_MS ?? 90_000),
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
