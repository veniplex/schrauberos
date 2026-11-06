/**
 * Ablauf des Launchers (ohne Prozess-, Netzwerk- und Zeitzugriff – die kommen als `LauncherDeps` von außen, in Tests als Fakes).
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
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { databaseFile } from "../server/db-client-path";
import { healthVerdict, isStarting } from "../lib/updates/health";
import { applyPendingRestore, confirmRestore, readApplied, rollbackRestore } from "../lib/updates/restore";
import { compareVersions } from "../lib/updates/semver";
import { afterFailure, afterHealthy, isCompatible, RESTART_EXIT_CODE, versionsToKeep, type VersionMeta } from "../lib/updates/state";
import { launcherCrashFile, pruneVersions, readActive, readMeta, readState, writeState } from "../lib/updates/store";

/** Ein gestarteter App-Prozess (echt: `ChildProcess`, im Test ein Fake). */
export interface AppProcess {
  /** Endet mit dem Exit-Code (durch ein Signal beendet: 1) */
  readonly exited: Promise<number>;
  hasExited(): boolean;
  kill(signal: NodeJS.Signals): void;
}

export type SpawnSpec = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };

export type LauncherDeps = {
  spawn(spec: SpawnSpec): AppProcess;
  /** Antwort von `/api/health`; null, wenn (noch) nicht erreichbar */
  health(): Promise<{ status: number; body: unknown } | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(message: string): void;
};

export type LauncherConfig = {
  /** Verzeichnis dieser App-Version */
  own: string;
  /** Verzeichnis der eingebauten Version (im Image /app) */
  builtin: string;
  port: string;
  /** Wie lange die App ohne Lebenszeichen „starting“ gesund werden darf */
  healthTimeoutMs: number;
  /** Harte Obergrenze, auch wenn die App ständig „starting“ meldet (Standard 15 Minuten, mindestens `healthTimeoutMs`) */
  healthMaxMs?: number;
  /** Prozessumgebung, die an die App weitergegeben wird */
  env: NodeJS.ProcessEnv;
  execPath: string;
};

/**
 * Kommando für die App dieser Version: mit der mitgelieferten Laufzeit (Lader + Bibliotheken + Node im Paket). Ohne Laufzeit
 * (Entwicklung) mit dem Node des Launchers.
 */
export function appCommand(own: string, execPath: string): { command: string; args: string[] } {
  const loaderFile = path.join(own, "runtime", "loader");
  if (existsSync(loaderFile)) {
    const loader = path.join(own, "runtime", readFileSync(loaderFile, "utf8").trim());
    return { command: loader, args: ["--library-path", path.join(own, "runtime", "lib"), path.join(own, "runtime", "node"), "server.js"] };
  }
  return { command: execPath, args: ["server.js"] };
}

/** Standard für die harte Obergrenze der Wartezeit auf die Gesundheit einer frisch gestarteten App. */
export const DEFAULT_HEALTH_MAX_MS = 15 * 60_000;

export function createLauncher(config: LauncherConfig, deps: LauncherDeps) {
  const OWN = path.resolve(config.own);
  const BUILTIN = path.resolve(config.builtin);
  const IS_BUILTIN = OWN === BUILTIN;
  const { log } = deps;

  let child: AppProcess | null = null;
  let stopping = false;

  /** Beendigungswunsch (SIGTERM/SIGINT): das Kind weiterreichen; true, wenn gerade kein Kind läuft (dann sofort beenden). */
  function requestStop(signal: NodeJS.Signals): boolean {
    stopping = true;
    child?.kill(signal);
    return !child;
  }

  /**
   * Wartet, bis die App gesund antwortet; false bei Zeitüberschreitung, vorzeitigem Ende oder „Neuinstallation nötig“. Die Frist (`healthTimeoutMs`) verlängert sich
   * jedes Mal um ihre volle Länge, wenn die App mit „starting“ antwortet (sie lebt und migriert noch) – höchstens bis zur harten Obergrenze `healthMaxMs` ab Start.
   */
  async function waitHealthy(proc: AppProcess): Promise<boolean> {
    const started = deps.now();
    const hardLimit = started + Math.max(config.healthMaxMs ?? DEFAULT_HEALTH_MAX_MS, config.healthTimeoutMs);
    let deadline = started + config.healthTimeoutMs;
    while (!proc.hasExited() && !stopping && deps.now() < deadline) {
      const res = await deps.health().catch(() => null);
      if (res) {
        if (isStarting(res.status, res.body)) deadline = Math.min(hardLimit, Math.max(deadline, deps.now() + config.healthTimeoutMs));
        const verdict = healthVerdict(res.status, res.body);
        if (verdict === "ok") return true;
        if (verdict === "fatal") {
          log("Die App meldet „Neuinstallation nötig“ (fremde Datenbank) und wird nie gesund – nicht weiter warten.");
          return false;
        }
      }
      await deps.sleep(1000);
    }
    return false;
  }

  function rollbackUpdate(reason: string) {
    const state = readState();
    log(`Version ${state.current} wird verworfen (${reason}), zurück auf ${state.previous ?? "die eingebaute Version"}.`);
    writeState(afterFailure(state, reason, new Date(deps.now()).toISOString()));
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
      last: { at: new Date(deps.now()).toISOString(), version, status: "rolled-back", reason: "Launcher stürzte ab" },
    });
  }

  /** Läuft, bis der Launcher enden soll; liefert den Exit-Code des Launchers (`RESTART_EXIT_CODE` = der Starter wählt neu). */
  async function run(): Promise<number> {
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

      const { command, args } = appCommand(OWN, config.execPath);
      const proc = deps.spawn({ command, args, cwd: OWN, env: { ...config.env, APP_UPDATER: "1", PORT: config.port, NODE_ENV: "production" } });
      child = proc;
      const exit = proc.exited;

      if (updatePending || restoreApplied) {
        if (await waitHealthy(proc)) {
          if (restoreApplied) confirmRestore(restoreApplied, new Date(deps.now()).toISOString());
          if (updatePending) writeState(afterHealthy(readState(), own.version, new Date(deps.now()).toISOString()));
          log(`Version ${own.version} läuft gesund.`);
        } else if (!stopping) {
          proc.kill("SIGKILL");
          await exit;
          child = null;
          // Erst die Daten zurücknehmen (die Wiederherstellung); bleibt es schlecht, im nächsten Durchlauf das Update
          if (restoreApplied) {
            log("Die wiederhergestellte Datenbank startet nicht gesund – die vorherige wird zurückgesetzt.");
            rollbackRestore(dbFile, restoreApplied, "antwortet nicht gesund", new Date(deps.now()).toISOString());
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
        rollbackRestore(dbFile, stillApplied, `Prozess beendet (Code ${code})`, new Date(deps.now()).toISOString());
        continue;
      }
      if (updatePending && readState().pending) {
        rollbackUpdate(`Prozess beendet (Code ${code})`);
        return RESTART_EXIT_CODE;
      }
      return code;
    }
  }

  return { run, requestStop };
}
