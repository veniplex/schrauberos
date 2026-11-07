/**
 * Ablauf des Launchers (ohne Prozess-, Netzwerk- und Zeitzugriff – die kommen als `LauncherDeps` von außen, in Tests als Fakes).
 *
 * Der Starter im Image (docker/bootstrap.c) prüft die aktive Version (Siegel + Dateiliste, README „Starter-Vertrauensanker“), wählt das Verzeichnis (Zeiger
 * `<DATA_DIR>/app/active`, sonst die eingebaute Version unter /app) und startet DESSEN Launcher. Jeder Launcher startet nur die App seiner eigenen Version –
 * und zwar **genau einmal je Aufruf**: Jeder Neustart der App geht über den Starter (Rückgabe von `RESTART_EXIT_CODE`), der dann neu prüft und neu wählt. Ein
 * Neustart im selben Launcher (wie früher bei Code 42 oder nach einem Rückfall der Wiederherstellung) ließe veränderten Code ungeprüft laufen.
 *  - Frisch installierte Version startet nicht gesund → Zustand zurücksetzen (Zeiger auf die Vorversion) und `RESTART_EXIT_CODE` melden.
 *  - Meldet die App `RESTART_EXIT_CODE` (nach Update oder Wiederherstellung): selbst mit `RESTART_EXIT_CODE` enden.
 *  - Vorgemerkte Datenbank-Wiederherstellung: Datei (und Dateien) vor dem Start austauschen, bei ungesundem Start zurücksetzen und `RESTART_EXIT_CODE` melden.
 *  - Der Launcher der **eingebauten** Version (er läuft, wenn der Starter keine installierte Version startet) wertet die Marker des Starters aus (Integritätsbefund,
 *    unklare Prüfung; `lib/updates/markers.ts`), fällt zuerst auf die Vorversion zurück (`RESTART_EXIT_CODE`: der Starter prüft sie), prüft die Kompatibilität mit der
 *    Datenbank (`lib/updates/compat.ts`: gesteuert stoppen statt still auf einem zu alten Code weiterlaufen) und gleicht den Zustand mit dem ab, was der Starter gewählt
 *    hat (`chooseStart`: ein neu gezogenes, neueres Image oder ein unverträgliches Paket lässt den Eintrag verfallen – ohne Alarm).
 *  - Ist die eingebaute Version neuer als die installierte oder unverträglich, verwirft die installierte Version sich selbst.
 * Migrationen und Basisdaten erledigt die App selbst (instrumentation.ts).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { databaseFile } from "../server/db-client-path";
import { blockedMigrations, knownMigrations } from "../lib/updates/compat";
import { healthVerdict, isStarting } from "../lib/updates/health";
import { integrityReason, parseInconclusive, parseVerifyFailed, versionFromMarker } from "../lib/updates/markers";
import { applyPendingRestore, confirmRestore, readApplied, rollbackRestore } from "../lib/updates/restore";
import { compareVersions } from "../lib/updates/semver";
import {
  afterFailure,
  afterHealthy,
  afterInconclusive,
  afterIntegrityFailure,
  chooseStart,
  INCONCLUSIVE_LIMIT,
  isCompatible,
  RESTART_EXIT_CODE,
  versionsToKeep,
  type UpdateState,
  type VersionMeta,
} from "../lib/updates/state";
import { incompatibleFile, inconclusiveFile, launcherCrashFile, pruneVersions, readMeta, readSmallFile, readState, verifyFailedFile, versionDir, writeState } from "../lib/updates/store";

/** Exit-Code des Launchers, wenn er die App absichtlich nicht startet (Rückfall-Version zu alt für die Datenbank): der Starter beendet dann den Container. */
export const INCOMPATIBLE_EXIT_CODE = 78;

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
  /**
   * Antwort von `/api/health`; null, wenn (noch) nicht erreichbar. `unresponsive`: Die Verbindung wurde angenommen, aber es kam keine HTTP-Antwort
   * (Event-Loop blockiert, etwa in einem synchronen Migrationsschritt) – gilt wie „starting“ als Lebenszeichen.
   */
  health(): Promise<{ status: number; body: unknown; unresponsive?: boolean } | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(message: string): void;
  /** Namen der in der Datenbank angewendeten Migrationen (nur lesend); `null`, wenn nicht lesbar – dann gibt es kein Urteil der Kompatibilitätsschranke. */
  appliedMigrations?(): string[] | null;
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
  const nowIso = () => new Date(deps.now()).toISOString();

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
   * jedes Mal um ihre volle Länge, wenn die App mit „starting“ antwortet (sie lebt und migriert noch) oder die Verbindung annimmt, aber nicht antwortet (Event-Loop in
   * einem synchronen Migrationsschritt blockiert) – höchstens bis zur harten Obergrenze `healthMaxMs` ab Start. Eine Verbindung, die verweigert wird, verlängert nie.
   */
  async function waitHealthy(proc: AppProcess): Promise<boolean> {
    const started = deps.now();
    const hardLimit = started + Math.max(config.healthMaxMs ?? DEFAULT_HEALTH_MAX_MS, config.healthTimeoutMs);
    let deadline = started + config.healthTimeoutMs;
    while (!proc.hasExited() && !stopping && deps.now() < deadline) {
      const res = await deps.health().catch(() => null);
      if (res) {
        if (res.unresponsive || isStarting(res.status, res.body)) deadline = Math.min(hardLimit, Math.max(deadline, deps.now() + config.healthTimeoutMs));
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
    writeState(afterFailure(state, reason, nowIso()));
  }

  // ───────── Rückfälle der eingebauten Version ─────────

  /**
   * Kompatibilitätsschranke: Würde der Rückfall auf `targetDir` auf eine Datenbank treffen, die Migrationen kennt, die dieser Code nicht kennt (und stammt der Rückfall
   * von einer bewährten Version), startet der Launcher die App **nicht**. Vermerkt den Grund (Datei `incompatible`) und liefert den Exit-Code, sonst `null`.
   */
  function stopIfIncompatible(targetDir: string, from: string, fromConfirmed: boolean): number | null {
    const blocked = blockedMigrations({ applied: deps.appliedMigrations?.() ?? null, known: knownMigrations(targetDir), fromConfirmed });
    if (blocked.length === 0) return null;
    const target = readMeta(targetDir)?.version ?? "?";
    const names = blocked.slice(0, 5).join(", ") + (blocked.length > 5 ? ", …" : "");
    log(
      `Rückfall von Version ${from} auf Version ${target} nicht möglich: Die Datenbank kennt ${blocked.length} Migration(en), die diese Version nicht kennt (${names}). ` +
        "Die App wird NICHT gestartet, um Daten nicht zu gefährden. Bitte das Docker-Image aktualisieren (docker compose pull && docker compose up -d) – " +
        `Fallback version ${target} is too old for the database; the app is not started. Please update the Docker image.`,
    );
    try {
      writeFileSync(incompatibleFile(), `${from}\n${blocked.length}\n`);
    } catch {
      /* nur ein Hinweis für den Betreiber */
    }
    return INCOMPATIBLE_EXIT_CODE;
  }

  /** Der Starter hat vermerkt, dass der Launcher einer installierten Version wiederholt abstürzte: diese Version verwerfen. Liefert einen Exit-Code, wenn der Launcher enden soll. */
  function handleLauncherCrash(): number | null {
    const marker = launcherCrashFile();
    if (!existsSync(marker)) return null;
    const version = versionFromMarker(readSmallFile(marker) ?? "") ?? "";
    rmSync(marker, { force: true });
    if (!version) return null;
    const state = readState();
    if (state.current === version) {
      const stop = stopIfIncompatible(BUILTIN, version, !state.pending);
      if (stop !== null) return stop;
    }
    log(`Der Launcher der Version ${version} ist wiederholt abgestürzt – Version wird verworfen.`);
    writeState({
      ...state,
      current: state.current === version ? null : state.current,
      previous: null,
      pending: false,
      failed: state.failed.includes(version) ? state.failed : [...state.failed, version],
      last: { at: nowIso(), version, status: "rolled-back", reason: "Launcher stürzte ab" },
    });
    return null;
  }

  /**
   * Integritätsbefund des Starters für `version`: sperren, auf die Vorversion zurückfallen (`RESTART_EXIT_CODE`: der Starter prüft sie selbst) und erst danach auf die
   * eingebaute Version. Vorher die Kompatibilitätsschranke.
   */
  function applyIntegrityFailure(state: UpdateState, version: string, reason: string, detail: string): number | null {
    const next = afterIntegrityFailure(state, version, reason, nowIso(), detail);
    if (state.current === version) {
      const stop = stopIfIncompatible(next.current ? versionDir(next.current) : BUILTIN, version, !state.pending);
      if (stop !== null) return stop;
    }
    log(`Version ${version} wird verworfen (Integritätsprüfung: ${reason}${detail ? `, ${detail}` : ""}); weiter mit ${next.current ?? "der eingebauten Version"}.`);
    writeState(next);
    return next.current && next.current !== version ? RESTART_EXIT_CODE : null;
  }

  /**
   * Marker des Starters auswerten (nur die eingebaute Version). Liefert einen Exit-Code, wenn der Launcher enden soll (Vorversion prüfen lassen, gesteuert stoppen),
   * sonst `null` (die eingebaute App läuft); `handled`: der Starter hat die eingebaute Version ausdrücklich für diesen Lauf gewählt (unklare Prüfung).
   */
  function handleStarterMarkers(): { exit: number | null; handled: boolean } {
    const failedText = readSmallFile(verifyFailedFile());
    const unclearText = readSmallFile(inconclusiveFile());
    rmSync(verifyFailedFile(), { force: true });
    rmSync(inconclusiveFile(), { force: true });

    const failed = failedText === null ? null : parseVerifyFailed(failedText);
    if (failedText !== null && !failed) log("Der Marker „verify-failed“ ist ungültig und wird ignoriert.");
    if (failed) return { exit: applyIntegrityFailure(readState(), failed.version, integrityReason(failed.code), failed.path), handled: true };

    const unclear = unclearText === null ? null : parseInconclusive(unclearText);
    if (unclear) {
      const state = readState();
      const next = afterInconclusive(state, unclear.version, unclear.reason, nowIso());
      if (next.inconclusive && next.inconclusive.count >= INCONCLUSIVE_LIMIT) {
        // Wiederholt unklar (etwa eine Platte, die nie fertig wird) ist kein Zufall mehr: wie ein Befund behandeln
        log(`Die Prüfung der Version ${unclear.version} blieb ${next.inconclusive.count}× unklar (${unclear.reason}) – sie gilt als fehlgeschlagen.`);
        return { exit: applyIntegrityFailure(state, unclear.version, integrityReason(17), `unklar: ${unclear.reason}`), handled: true };
      }
      writeState(next);
      log(`Die Prüfung der Version ${unclear.version} blieb unklar (${unclear.reason}, ${next.inconclusive?.count}. Mal) – für diesen Start läuft die eingebaute Version, der nächste Start prüft erneut.`);
      return { exit: null, handled: true };
    }
    return { exit: null, handled: false };
  }

  /**
   * Gleicht den Zustand mit dem ab, was der Starter gewählt hat (er hat hier die eingebaute Version gestartet, ohne Marker): Verweist der Zustand auf eine Version, die nicht
   * (mehr) startbar ist – das Image ist neuer, der Starter-Vertrag oder die Architektur passen nicht, die Dateien fehlen –, verfällt der Eintrag; kein Alarm, kein Marker.
   * `chooseStart` ist die einzige Quelle dieses Urteils. Ist die Version dagegen startbar, hat der Starter sie aus einem Grund übergangen, den hier niemand beheben kann: der
   * Zustand bleibt unverändert (eine gesunde Version wird nie wegen einer Unstimmigkeit gelöscht).
   */
  function reconcile(): number | null {
    const state = readState();
    if (!state.current) return null;
    const builtin = readMeta(BUILTIN);
    if (!builtin) return null;
    const installed = (version: string) => readMeta(versionDir(version));
    const choice = chooseStart(state, builtin, installed, compareVersions);
    if (choice.kind === "volume") {
      log(`Hinweis: Version ${choice.version} ist eingetragen und startbar, der Starter hat aber die eingebaute Version gewählt – der Zustand bleibt unverändert.`);
      return null;
    }
    const meta = installed(state.current);
    const olderThanImage = !!meta && compareVersions(meta.version, builtin.version) <= 0;
    // Ein neu gezogenes, neueres Image enthält alle Migrationen der älteren Version; nur sonst (fehlende Dateien, Vertrag) kann die Datenbank dem Code voraus sein
    if (!olderThanImage) {
      const stop = stopIfIncompatible(BUILTIN, state.current, !state.pending);
      if (stop !== null) return stop;
    }
    log(`Version ${state.current} aus dem Update-Volume ist nicht (mehr) gültig – die eingebaute Version ${builtin.version} wird verwendet.`);
    writeState({ ...state, current: null, previous: null, pending: false });
    return null;
  }

  /** Läuft, bis der Launcher enden soll; liefert den Exit-Code des Launchers (`RESTART_EXIT_CODE` = der Starter prüft und wählt neu). Startet die App höchstens einmal. */
  async function run(): Promise<number> {
    const dbFile = databaseFile();
    const own: VersionMeta = readMeta(OWN) ?? { version: "0.0.0", base: 0 };

    if (IS_BUILTIN) {
      const crash = handleLauncherCrash();
      if (crash !== null) return crash;
      const markers = handleStarterMarkers();
      if (markers.exit !== null) return markers.exit;
      if (!markers.handled) {
        const stop = reconcile();
        if (stop !== null) return stop;
      }
      rmSync(incompatibleFile(), { force: true }); // wir kommen an der Schranke vorbei: der Hinweis ist erledigt
    } else {
      // Eine installierte Version gilt nur, wenn sie neuer als die eingebaute und mit ihr verträglich ist und der Zustand auf sie zeigt
      const builtin = readMeta(BUILTIN);
      const state = readState();
      if (!builtin || !isCompatible(own, builtin) || compareVersions(own.version, builtin.version) <= 0 || state.failed.includes(own.version) || state.current !== own.version) {
        log(`Version ${own.version} aus dem Update-Volume ist nicht (mehr) gültig – eingebaute Version ${builtin?.version ?? "?"} wird verwendet.`);
        writeState({ ...state, current: null, previous: null, pending: false });
        return RESTART_EXIT_CODE;
      }
      // Der Starter hat diese Version geprüft und gestartet: eine frühere unklare Prüfung hat sich erledigt
      if (state.inconclusive?.version === own.version) writeState({ ...state, inconclusive: null });
    }
    pruneVersions(versionsToKeep(readState()));

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
        if (restoreApplied) confirmRestore(restoreApplied, nowIso());
        if (updatePending) writeState(afterHealthy(readState(), own.version, nowIso()));
        log(`Version ${own.version} läuft gesund.`);
      } else if (!stopping) {
        proc.kill("SIGKILL");
        await exit;
        child = null;
        // Erst die Daten zurücknehmen (die Wiederherstellung); der Neustart geht über den Starter, der die Versionen neu prüft. Bleibt es schlecht, nimmt der nächste Lauf das Update zurück.
        if (restoreApplied) {
          log("Die wiederhergestellte Datenbank startet nicht gesund – die vorherige wird zurückgesetzt.");
          rollbackRestore(dbFile, restoreApplied, "antwortet nicht gesund", nowIso());
          return RESTART_EXIT_CODE;
        }
        rollbackUpdate("antwortet nicht gesund");
        return RESTART_EXIT_CODE;
      }
    }

    const code = await exit;
    child = null;
    if (stopping) return 0;
    if (code === RESTART_EXIT_CODE) {
      // Update oder Wiederherstellung angefordert: der Starter prüft neu und startet den Launcher der dann gültigen Version
      log("Neustart angefordert.");
      return RESTART_EXIT_CODE;
    }
    // Abbruch vor der Bestätigung (z. B. Migration scheitert): zurücknehmen, statt in einer Dauerschleife zu starten
    const stillApplied = readApplied();
    if (stillApplied) {
      rollbackRestore(dbFile, stillApplied, `Prozess beendet (Code ${code})`, nowIso());
      return RESTART_EXIT_CODE;
    }
    if (updatePending && readState().pending) {
      rollbackUpdate(`Prozess beendet (Code ${code})`);
      return RESTART_EXIT_CODE;
    }
    return code;
  }

  return { run, requestStop };
}
