/**
 * Launcher: gehört zu jeder App-Version (liegt im Paket, nicht im Image) und läuft auf deren eigener Laufzeit.
 *
 * Der winzige, unveränderliche Starter im Image (docker/bootstrap.c) wählt das Verzeichnis der aktiven Version (Zeiger
 * `<DATA_DIR>/app/active`, sonst die eingebaute Version unter /app) und startet DESSEN Launcher. Jeder Launcher startet nur die
 * App seiner eigenen Version:
 *  - Frisch installierte Version startet nicht gesund → Zustand zurücksetzen (Zeiger auf die Vorversion) und `RESTART_EXIT_CODE`
 *    melden; der Starter wählt dann neu und startet den Launcher der Vorversion.
 *  - Meldet die App `RESTART_EXIT_CODE` (nach Update oder Wiederherstellung): zeigt der Zeiger auf eine andere Version, selbst
 *    mit `RESTART_EXIT_CODE` enden; sonst die App im selben Launcher neu starten.
 *  - Vorgemerkte Datenbank-Wiederherstellung: Datei (und Dateien) vor dem Start austauschen, bei ungesundem Start zurücksetzen.
 *  - Ist die eingebaute Version neuer als die installierte (neues Image gezogen) oder unverträglich (Starter-Vertrag,
 *    Architektur), verwirft die installierte Version sich selbst.
 * Migrationen und Basisdaten erledigt die App selbst (instrumentation.ts). Der Launcher kennt kein Datenbank-Schema.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { compareVersions } from "../lib/updates/semver";
import { applyPendingRestore, confirmRestore, readApplied, rollbackRestore } from "../lib/updates/restore";
import { afterFailure, afterHealthy, isCompatible, RESTART_EXIT_CODE, versionsToKeep, type VersionMeta } from "../lib/updates/state";
import { launcherCrashFile, pruneVersions, readActive, readMeta, readState, writeState } from "../lib/updates/store";
import { databaseFile } from "../server/db-client-path";

const OWN = path.resolve(process.cwd());
const BUILTIN = path.resolve(process.env.BUILTIN_DIR ?? "/app");
const IS_BUILTIN = OWN === BUILTIN;
const PORT = process.env.PORT ?? "3000";
const HEALTH_TIMEOUT_MS = Number(process.env.LAUNCHER_HEALTH_TIMEOUT_MS ?? 90_000);
const log = (message: string) => console.log(`[launcher] ${message}`);

let child: ChildProcess | null = null;
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
    if (!child) process.exit(0);
  });
}

/**
 * Kommando für die App dieser Version: mit der mitgelieferten Laufzeit (Lader + Bibliotheken + Node im Paket). Ohne Laufzeit
 * (Entwicklung) mit dem Node des Launchers.
 */
function appCommand(): { command: string; args: string[] } {
  const loaderFile = path.join(OWN, "runtime", "loader");
  if (existsSync(loaderFile)) {
    const loader = path.join(OWN, "runtime", readFileSync(loaderFile, "utf8").trim());
    return { command: loader, args: ["--library-path", path.join(OWN, "runtime", "lib"), path.join(OWN, "runtime", "node"), "server.js"] };
  }
  return { command: process.execPath, args: ["server.js"] };
}

/** Wartet, bis die App gesund antwortet; false bei Zeitüberschreitung oder vorzeitigem Ende. */
async function waitHealthy(proc: ChildProcess): Promise<boolean> {
  let exited = false;
  proc.once("exit", () => (exited = true));
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (!exited && !stopping && Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* noch nicht bereit */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function rollbackUpdate(reason: string) {
  const state = readState();
  log(`Version ${state.current} wird verworfen (${reason}), zurück auf ${state.previous ?? "die eingebaute Version"}.`);
  writeState(afterFailure(state, reason, new Date().toISOString()));
}

/** Der Starter hat vermerkt, dass der Launcher einer installierten Version wiederholt abstürzte: diese Version verwerfen. */
function handleLauncherCrash() {
  const marker = launcherCrashFile();
  if (!existsSync(marker)) return;
  const version = path.basename(readFileSync(marker, "utf8").trim());
  rmSync(marker, { force: true });
  const state = readState();
  log(`Der Launcher der Version ${version} ist wiederholt abgestürzt – Version wird verworfen.`);
  writeState({
    ...state,
    current: state.current === version ? null : state.current,
    previous: null,
    pending: false,
    failed: state.failed.includes(version) ? state.failed : [...state.failed, version],
    last: { at: new Date().toISOString(), version, status: "rolled-back", reason: "Launcher stürzte ab" },
  });
}

async function main(): Promise<number> {
  const dbFile = databaseFile();
  const own: VersionMeta = readMeta(OWN) ?? { version: "0.0.0", base: 0 };

  if (IS_BUILTIN) {
    handleLauncherCrash();
  } else {
    // Eine installierte Version gilt nur, wenn sie neuer als die eingebaute und mit ihr verträglich ist und der Zustand auf sie zeigt
    const builtin = readMeta(BUILTIN);
    const state = readState();
    if (!builtin || !isCompatible(own, builtin) || compareVersions(own.version, builtin.version) <= 0 || state.failed.includes(own.version) || state.current !== own.version) {
      log(`Version ${own.version} aus dem Update-Volume ist nicht (mehr) gültig – eingebaute Version ${builtin?.version ?? "?"} wird verwendet.`);
      writeState({ ...state, current: null, previous: null, pending: false });
      return RESTART_EXIT_CODE;
    }
  }
  pruneVersions(versionsToKeep(readState()));

  for (;;) {
    // 1) Vorgemerkte Wiederherstellung einspielen (oder eine noch unbestätigte aus einem abgebrochenen Start wieder aufnehmen)
    const swapped = applyPendingRestore(dbFile);
    if (swapped) log(`Datenbank${swapped.files ? " und Dateien" : ""} wiederhergestellt aus ${swapped.from}.`);
    const restoreApplied = swapped ?? readApplied();

    const state = readState();
    const updatePending = !IS_BUILTIN && state.pending && state.current === own.version;
    log(`Starte Version ${own.version} (${IS_BUILTIN ? "eingebaut" : "aus dem Update-Volume"}) …`);

    const { command, args } = appCommand();
    child = spawn(command, args, { cwd: OWN, stdio: "inherit", env: { ...process.env, APP_UPDATER: "1", PORT, NODE_ENV: "production" } });
    const exit = new Promise<number>((resolve) => {
      child!.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      child!.on("error", () => resolve(1));
    });

    if (updatePending || restoreApplied) {
      if (await waitHealthy(child)) {
        if (restoreApplied) confirmRestore(restoreApplied, new Date().toISOString());
        if (updatePending) writeState(afterHealthy(readState(), own.version, new Date().toISOString()));
        log(`Version ${own.version} läuft gesund.`);
      } else if (!stopping) {
        child.kill("SIGKILL");
        await exit;
        child = null;
        // Erst die Daten zurücknehmen (die Wiederherstellung); bleibt es schlecht, im nächsten Durchlauf das Update
        if (restoreApplied) {
          log("Die wiederhergestellte Datenbank startet nicht gesund – die vorherige wird zurückgesetzt.");
          rollbackRestore(dbFile, restoreApplied, "antwortet nicht gesund", new Date().toISOString());
          continue;
        }
        rollbackUpdate("antwortet nicht gesund");
        return RESTART_EXIT_CODE;
      }
    }

    const code = await exit;
    child = null;
    if (stopping) return 0;
    if (code === RESTART_EXIT_CODE) {
      // Zeigt der Zeiger inzwischen auf eine andere Version, übernimmt deren Launcher (über den Starter)
      const active = readActive();
      if ((active ? path.resolve(active) : BUILTIN) !== OWN) {
        log("Eine andere Version ist aktiv – wird neu ausgewählt.");
        return RESTART_EXIT_CODE;
      }
      log("Neustart angefordert.");
      continue;
    }
    // Abbruch vor der Bestätigung (z. B. Migration scheitert): zurücknehmen, statt in einer Dauerschleife zu starten
    const stillApplied = readApplied();
    if (stillApplied) {
      rollbackRestore(dbFile, stillApplied, `Prozess beendet (Code ${code})`, new Date().toISOString());
      continue;
    }
    if (updatePending && readState().pending) {
      rollbackUpdate(`Prozess beendet (Code ${code})`);
      return RESTART_EXIT_CODE;
    }
    return code;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("[launcher] Unerwarteter Fehler", error);
    process.exit(1);
  },
);
