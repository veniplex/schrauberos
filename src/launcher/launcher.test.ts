import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { applyPendingRestore, pendingDbFile, readApplied, readRestoreResult, restoreDir, writePending } from "../lib/updates/restore";
import { RESTART_EXIT_CODE, emptyState } from "../lib/updates/state";
import { activeFile, incompatibleFile, inconclusiveFile, launcherCrashFile, readActive, readState, updatesDir, verifyFailedFile, versionDir, writeState } from "../lib/updates/store";
import { createLauncher, DEFAULT_HEALTH_MAX_MS, INCOMPATIBLE_EXIT_CODE, type AppProcess, type LauncherConfig, type LauncherDeps, type SpawnSpec } from "./launcher";

/**
 * Ablauf des Launchers mit Fake-Prozess, Fake-Gesundheitsabfrage und Fake-Uhr gegen ein echtes temporäres Datenverzeichnis:
 * Start, Neustart, Zeigerwechsel, Bestätigung/Rückfall eines Updates, Wiederherstellung, abgestürzte Launcher, Beenden per Signal.
 */
const root = mkdtempSync(path.join(tmpdir(), "so-launcher-"));
const data = path.join(root, "data");
const builtin = path.join(root, "app");
const dbFile = path.join(data, "schrauberos.db");
after(() => rmSync(root, { recursive: true, force: true }));

const meta = (dir: string, version: string, base = 1) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "version.json"), JSON.stringify({ version, base }));
};
const volume = (version: string) => versionDir(version, data);

/** Ein Fake-Prozess, den der Test beendet (oder der auf `kill` endet). */
class FakeProc implements AppProcess {
  readonly kills: string[] = [];
  readonly exited: Promise<number>;
  private done = false;
  private finish!: (code: number) => void;
  constructor(readonly spec: SpawnSpec) {
    this.exited = new Promise((resolve) => (this.finish = resolve));
  }
  hasExited = () => this.done;
  exit(code: number) {
    if (this.done) return;
    this.done = true;
    this.finish(code);
  }
  kill(signal: NodeJS.Signals) {
    this.kills.push(signal);
    this.exit(1);
  }
}

type Rig = {
  spawned: FakeProc[];
  logs: string[];
  clock: { ms: number };
  /** Verhalten des Prozesses je Start (Nummer ab 0); Standard: endet sofort mit Code 0 */
  onSpawn: (proc: FakeProc, index: number) => void;
  /** Antworten von /api/health in Reihenfolge; danach `null` (nicht erreichbar) */
  healthReplies: Array<{ status: number; body: unknown } | null>;
  healthCalls: number;
  /** Angewendete Migrationen der Datenbank für die Kompatibilitätsschranke; `null` = nicht lesbar */
  applied: string[] | null;
};
let rig: Rig;
const savedEnv = { DATA_DIR: process.env.DATA_DIR, DATABASE_URL: process.env.DATABASE_URL };

function launcherFor(own: string, overrides: Partial<LauncherConfig> = {}) {
  const deps: LauncherDeps = {
    spawn: (spec) => {
      const proc = new FakeProc(spec);
      rig.spawned.push(proc);
      const index = rig.spawned.length - 1;
      queueMicrotask(() => rig.onSpawn(proc, index));
      return proc;
    },
    health: async () => {
      rig.healthCalls++;
      return rig.healthReplies.shift() ?? null;
    },
    sleep: async (ms) => void (rig.clock.ms += ms),
    now: () => rig.clock.ms,
    log: (message) => void rig.logs.push(message),
    appliedMigrations: () => rig.applied,
  };
  const config: LauncherConfig = { own, builtin, port: "3999", healthTimeoutMs: 10_000, env: { PATH: "x" } as unknown as NodeJS.ProcessEnv, execPath: "/usr/bin/node", ...overrides };
  return createLauncher(config, deps);
}

beforeEach(() => {
  rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(dbFile, "DB");
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `file:${dbFile}`;
  rmSync(builtin, { recursive: true, force: true });
  meta(builtin, "1.0.0");
  rig = { spawned: [], logs: [], clock: { ms: Date.parse("2026-01-01T00:00:00Z") }, onSpawn: (proc) => proc.exit(0), healthReplies: [], healthCalls: 0, applied: null };
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ok = { status: 200, body: { status: "ok" } };

describe("eingebaute Version", () => {
  it("startet die App mit Umgebung für den Launcher-Betrieb und gibt deren Exit-Code weiter", async () => {
    rig.onSpawn = (proc) => proc.exit(3);
    assert.equal(await launcherFor(builtin).run(), 3);
    assert.equal(rig.spawned.length, 1);
    const { spec } = rig.spawned[0];
    assert.equal(spec.command, "/usr/bin/node", "ohne mitgelieferte Laufzeit (Entwicklung) läuft die App mit dem Node des Launchers");
    assert.deepEqual(spec.args, ["server.js"]);
    assert.equal(spec.cwd, path.resolve(builtin));
    assert.equal(spec.env.APP_UPDATER, "1");
    assert.equal(spec.env.PORT, "3999");
    assert.equal(spec.env.NODE_ENV, "production");
    assert.equal(spec.env.PATH, "x", "die übrige Umgebung bleibt erhalten");
    assert.equal(rig.healthCalls, 0, "ohne Update oder Wiederherstellung wird nicht auf Gesundheit gewartet");
  });

  it("nutzt die mitgelieferte Laufzeit (Lader + Bibliotheken + Node), wenn das Paket sie enthält", async () => {
    mkdirSync(path.join(builtin, "runtime"), { recursive: true });
    writeFileSync(path.join(builtin, "runtime", "loader"), "ld-linux-x86-64.so.2\n");
    await launcherFor(builtin).run();
    const { command, args } = rig.spawned[0].spec;
    assert.equal(command, path.join(builtin, "runtime", "ld-linux-x86-64.so.2"));
    assert.deepEqual(args, ["--library-path", path.join(builtin, "runtime", "lib"), path.join(builtin, "runtime", "node"), "server.js"]);
  });

  it("startet die App nur ein einziges Mal: auf einen Neustart-Wunsch (Exit 42) antwortet der Launcher mit 42, der Starter prüft und startet neu (kein Neustart im Launcher)", async () => {
    rig.onSpawn = (proc) => proc.exit(RESTART_EXIT_CODE);
    assert.equal(await launcherFor(builtin).run(), RESTART_EXIT_CODE);
    assert.equal(rig.spawned.length, 1, "genau ein Start je Aufruf – ein zweiter Start im selben Launcher liefe ohne Prüfung des Starters");
    assert.ok(rig.logs.some((l) => l.includes("Neustart angefordert")));
  });

  it("gibt bei Neustart-Wunsch mit geändertem Zeiger Exit 42 zurück, damit der Starter die andere Version wählt", async () => {
    meta(volume("1.1.0"), "1.1.0");
    rig.onSpawn = (proc) => {
      writeState({ ...emptyState(), current: "1.1.0", pending: true }, data);
      proc.exit(RESTART_EXIT_CODE);
    };
    assert.equal(await launcherFor(builtin).run(), RESTART_EXIT_CODE);
    assert.equal(rig.spawned.length, 1);
  });

  it("verwirft eine installierte Version, deren Launcher laut Starter wiederholt abgestürzt ist", async () => {
    meta(volume("1.1.0"), "1.1.0");
    writeState({ ...emptyState(), current: "1.1.0", previous: null }, data);
    writeFileSync(launcherCrashFile(data), `${volume("1.1.0")}\n`);
    await launcherFor(builtin).run();
    const state = readState(data);
    assert.equal(state.current, null);
    assert.deepEqual(state.failed, ["1.1.0"]);
    assert.equal(state.last?.status, "rolled-back");
    assert.equal(existsSync(launcherCrashFile(data)), false, "der Marker wird verbraucht");
  });

  it("Beenden per Signal: die laufende App bekommt das Signal und der Launcher endet mit 0", async () => {
    const launcher = launcherFor(builtin);
    rig.onSpawn = (proc) => {
      assert.equal(launcher.requestStop("SIGTERM"), false, "es läuft ein Kind, der Launcher wartet auf dessen Ende");
      assert.deepEqual(proc.kills, ["SIGTERM"]);
    };
    assert.equal(await launcher.run(), 0);
  });

  it("Beenden ohne laufendes Kind: sofort beenden", () => {
    assert.equal(launcherFor(builtin).requestStop("SIGINT"), true);
  });
});

describe("installierte Version (Update)", () => {
  const install = (version = "1.1.0", pending = true) => {
    meta(volume(version), version);
    writeState({ ...emptyState(), current: version, previous: null, pending }, data);
  };

  it("bestätigt das Update, sobald die App gesund antwortet (nach einigen Wartezeiten)", async () => {
    install();
    rig.healthReplies = [null, { status: 503, body: { status: "starting" } }, ok];
    rig.onSpawn = (proc) => void proc.exited; // läuft, bis der Test sie beendet
    const launcher = launcherFor(volume("1.1.0"));
    const finished = launcher.run();
    // Nach der Bestätigung beendet sich die App
    for (let i = 0; i < 50 && readState(data).pending; i++) await new Promise((r) => setImmediate(r));
    assert.equal(readState(data).pending, false);
    assert.equal(readState(data).last?.status, "ok");
    assert.equal(readState(data).last?.version, "1.1.0");
    rig.spawned[0].exit(0);
    assert.equal(await finished, 0);
    assert.equal(rig.healthCalls, 3);
  });

  it("fällt zurück, wenn die App nie gesund antwortet: Prozess beenden, Zustand zurücksetzen, Exit 42", async () => {
    meta(volume("1.0.5"), "1.0.5");
    meta(volume("1.1.0"), "1.1.0");
    writeState({ ...emptyState(), current: "1.1.0", previous: "1.0.5", pending: true }, data);
    rig.onSpawn = () => undefined;
    assert.equal(await launcherFor(volume("1.1.0")).run(), RESTART_EXIT_CODE);
    assert.deepEqual(rig.spawned[0].kills, ["SIGKILL"]);
    const state = readState(data);
    assert.equal(state.current, "1.0.5");
    assert.equal(state.pending, false);
    assert.deepEqual(state.failed, ["1.1.0"]);
    assert.equal(state.last?.reason, "antwortet nicht gesund");
    assert.ok(rig.clock.ms - Date.parse("2026-01-01T00:00:00Z") >= 10_000, "es wurde bis zur Frist gewartet");
  });

  describe("Gesundheitsfenster bei langen Migrationen", () => {
    const starting = { status: 503, body: { status: "starting" } };
    const started = () => Date.parse("2026-01-01T00:00:00Z");

    it("verlängert sich, solange die App „starting“ meldet: eine Migration, die länger als die übliche Frist dauert, führt nicht zum Rückfall", async () => {
      install();
      // 40 Sekunden „starting“ bei einer Frist von 10 Sekunden, dann gesund
      rig.healthReplies = [...Array.from({ length: 40 }, () => starting), ok];
      rig.onSpawn = (proc) => void proc.exited;
      const finished = launcherFor(volume("1.1.0"), { healthTimeoutMs: 10_000, healthMaxMs: 120_000 }).run();
      for (let i = 0; i < 200 && readState(data).pending; i++) await new Promise((r) => setImmediate(r));
      assert.equal(readState(data).pending, false, "Update bestätigt");
      assert.equal(readState(data).current, "1.1.0");
      assert.ok(rig.clock.ms - started() >= 40_000, "es wurde länger als die Grundfrist gewartet");
      assert.deepEqual(rig.spawned[0].kills, [], "die App wurde nicht abgeschossen");
      rig.spawned[0].exit(0);
      assert.equal(await finished, 0);
    });

    it("hat eine harte Obergrenze: eine App, die ewig „starting“ meldet, wird nach healthMaxMs verworfen", async () => {
      meta(volume("1.0.5"), "1.0.5");
      meta(volume("1.1.0"), "1.1.0");
      writeState({ ...emptyState(), current: "1.1.0", previous: "1.0.5", pending: true }, data);
      rig.healthReplies = Array.from({ length: 1000 }, () => starting);
      rig.onSpawn = () => undefined;
      assert.equal(await launcherFor(volume("1.1.0"), { healthTimeoutMs: 10_000, healthMaxMs: 60_000 }).run(), RESTART_EXIT_CODE);
      assert.deepEqual(rig.spawned[0].kills, ["SIGKILL"]);
      const waited = rig.clock.ms - started();
      assert.ok(waited >= 60_000 && waited <= 62_000, `bis zur Obergrenze gewartet, nicht länger: ${waited} ms`);
      assert.equal(readState(data).current, "1.0.5");
      assert.deepEqual(readState(data).failed, ["1.1.0"]);
    });

    it("verlängert nur bei „starting“: eine nicht erreichbare App (null) oder ein 503 „error“ hält die Grundfrist ein", async () => {
      for (const reply of [null, { status: 503, body: { status: "error" } }, { status: 502, body: null }]) {
        install();
        rig.healthReplies = Array.from({ length: 1000 }, () => reply);
        rig.onSpawn = () => undefined;
        const before = rig.clock.ms;
        assert.equal(await launcherFor(volume("1.1.0"), { healthTimeoutMs: 10_000, healthMaxMs: 600_000 }).run(), RESTART_EXIT_CODE);
        const waited = rig.clock.ms - before;
        assert.ok(waited >= 10_000 && waited <= 12_000, `Grundfrist: ${waited} ms`);
        rig.spawned.length = 0;
        rig.healthCalls = 0;
      }
    });

    it("verlängert auch, wenn die Verbindung angenommen wird, aber nichts antwortet (Event-Loop blockiert: synchroner Migrationsschritt) – bis zur Obergrenze", async () => {
      const silent = { status: 0, body: null, unresponsive: true };
      install();
      rig.healthReplies = [...Array.from({ length: 40 }, () => silent), ok];
      rig.onSpawn = (proc) => void proc.exited;
      const finished = launcherFor(volume("1.1.0"), { healthTimeoutMs: 10_000, healthMaxMs: 120_000 }).run();
      for (let i = 0; i < 200 && readState(data).pending; i++) await new Promise((r) => setImmediate(r));
      assert.equal(readState(data).pending, false, "Update bestätigt");
      assert.ok(rig.clock.ms - started() >= 40_000, "länger als die Grundfrist gewartet");
      rig.spawned[0].exit(0);
      assert.equal(await finished, 0);

      // …aber nicht ewig
      install();
      rig.spawned.length = 0;
      rig.healthReplies = Array.from({ length: 1000 }, () => silent);
      rig.onSpawn = () => undefined;
      const before = rig.clock.ms;
      assert.equal(await launcherFor(volume("1.1.0"), { healthTimeoutMs: 10_000, healthMaxMs: 60_000 }).run(), RESTART_EXIT_CODE);
      const waited = rig.clock.ms - before;
      assert.ok(waited >= 60_000 && waited <= 62_000, `bis zur Obergrenze: ${waited} ms`);
    });

    it("ohne healthMaxMs gilt ein Standard von 15 Minuten; die Grundfrist wird nie unterschritten", async () => {
      assert.equal(DEFAULT_HEALTH_MAX_MS, 15 * 60_000);
      install();
      rig.healthReplies = Array.from({ length: 5000 }, () => starting);
      rig.onSpawn = () => undefined;
      const before = rig.clock.ms;
      assert.equal(await launcherFor(volume("1.1.0"), { healthTimeoutMs: 10_000 }).run(), RESTART_EXIT_CODE);
      const waited = rig.clock.ms - before;
      assert.ok(waited >= 15 * 60_000 && waited <= 15 * 60_000 + 2000, `${waited} ms`);

      install();
      rig.spawned.length = 0;
      rig.healthReplies = Array.from({ length: 5000 }, () => starting);
      const before2 = rig.clock.ms;
      assert.equal(await launcherFor(volume("1.1.0"), { healthTimeoutMs: 20_000, healthMaxMs: 5_000 }).run(), RESTART_EXIT_CODE);
      assert.ok(rig.clock.ms - before2 >= 20_000, "die Obergrenze liegt nie unter der Grundfrist");
    });
  });

  it("wartet bei „Neuinstallation nötig“ (503 reinstall) nicht bis zur Frist, sondern fällt sofort zurück", async () => {
    install();
    rig.healthReplies = [{ status: 503, body: { status: "reinstall" } }];
    rig.onSpawn = () => undefined;
    assert.equal(await launcherFor(volume("1.1.0")).run(), RESTART_EXIT_CODE);
    assert.equal(rig.healthCalls, 1);
    assert.equal(readState(data).current, null);
    assert.deepEqual(readState(data).failed, ["1.1.0"]);
  });

  it("fällt zurück, wenn der Prozess vor der Bestätigung endet", async () => {
    install();
    rig.onSpawn = (proc) => proc.exit(1);
    assert.equal(await launcherFor(volume("1.1.0")).run(), RESTART_EXIT_CODE);
    assert.ok(rig.healthCalls <= 1, "ein beendeter Prozess wird nicht weiter abgefragt");
    assert.equal(readState(data).current, null);
    assert.deepEqual(readState(data).failed, ["1.1.0"]);
  });

  it("verwirft sich selbst, wenn sie nicht neuer ist als die eingebaute Version (neues Image gezogen)", async () => {
    install("0.9.0");
    assert.equal(await launcherFor(volume("0.9.0")).run(), RESTART_EXIT_CODE);
    assert.equal(rig.spawned.length, 0, "es wird nichts gestartet");
    assert.equal(readState(data).current, null);
  });

  it("verwirft sich selbst bei anderem Starter-Vertrag (Basis) oder wenn der Zustand nicht auf sie zeigt oder sie als fehlerhaft gilt", async () => {
    meta(volume("1.1.0"), "1.1.0", 2);
    writeState({ ...emptyState(), current: "1.1.0" }, data);
    assert.equal(await launcherFor(volume("1.1.0")).run(), RESTART_EXIT_CODE, "Basis unverträglich");

    install("1.2.0", false);
    writeState({ ...emptyState(), current: "1.1.5" }, data);
    assert.equal(await launcherFor(volume("1.2.0")).run(), RESTART_EXIT_CODE, "Zustand zeigt auf eine andere Version");

    install("1.3.0", false);
    writeState({ ...readState(data), failed: ["1.3.0"] }, data);
    assert.equal(await launcherFor(volume("1.3.0")).run(), RESTART_EXIT_CODE, "als fehlerhaft markiert");
    assert.equal(rig.spawned.length, 0);
  });

  it("eine bereits bestätigte Version startet ohne auf Gesundheit zu warten", async () => {
    install("1.1.0", false);
    assert.equal(await launcherFor(volume("1.1.0")).run(), 0);
    assert.equal(rig.healthCalls, 0);
    assert.equal(readState(data).current, "1.1.0");
  });

  it("räumt nicht mehr gebrauchte Versionen auf", async () => {
    install("1.1.0", false);
    meta(volume("0.5.0"), "0.5.0");
    await launcherFor(volume("1.1.0")).run();
    assert.equal(existsSync(volume("0.5.0")), false);
    assert.equal(existsSync(volume("1.1.0")), true);
  });
});

describe("Wiederherstellung", () => {
  const stage = (content: string) => {
    mkdirSync(restoreDir(data), { recursive: true });
    writeFileSync(pendingDbFile(data), content);
    writePending({ from: "sicherung-1", at: "2026-01-01T00:00:00.000Z", files: false }, data);
  };

  it("spielt die vorgemerkte Datenbank vor dem Start ein und bestätigt sie, wenn die App gesund antwortet", async () => {
    stage("WIEDERHERGESTELLT");
    rig.healthReplies = [ok];
    const finished = launcherFor(builtin).run();
    for (let i = 0; i < 50 && !readRestoreResult(data); i++) await new Promise((r) => setImmediate(r));
    assert.equal(readFileSync(dbFile, "utf8"), "WIEDERHERGESTELLT");
    assert.equal(readRestoreResult(data)?.status, "ok");
    assert.equal(readApplied(data), null);
    rig.spawned[0].exit(0);
    assert.equal(await finished, 0);
  });

  it("setzt die vorherige Datenbank zurück, wenn die wiederhergestellte nicht gesund startet, und meldet Exit 42 (der Starter prüft neu; der Rückfall startet die App nicht im selben Launcher)", async () => {
    stage("KAPUTT");
    rig.onSpawn = () => undefined; // nie gesund
    assert.equal(await launcherFor(builtin).run(), RESTART_EXIT_CODE);
    assert.equal(rig.spawned.length, 1, "kein zweiter Start im selben Launcher");
    assert.deepEqual(rig.spawned[0].kills, ["SIGKILL"]);
    assert.equal(readFileSync(dbFile, "utf8"), "DB", "die vorherige Datenbank ist wieder da");
    assert.equal(readRestoreResult(data)?.status, "rolled-back");
    // Der Starter ruft den Launcher erneut auf: jetzt gibt es nichts mehr zurückzunehmen, die App läuft normal – die Schleife endet
    rig.spawned.length = 0;
    rig.onSpawn = (proc) => proc.exit(0);
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
    assert.equal(readFileSync(dbFile, "utf8"), "DB");
  });

  it("setzt zurück, wenn der Prozess nach dem Einspielen sofort endet (z. B. Migration scheitert) – Exit 42, genau ein Start", async () => {
    stage("KAPUTT");
    rig.onSpawn = (proc) => proc.exit(1);
    assert.equal(await launcherFor(builtin).run(), RESTART_EXIT_CODE);
    assert.equal(rig.spawned.length, 1);
    assert.equal(readFileSync(dbFile, "utf8"), "DB");
    assert.equal(readRestoreResult(data)?.status, "rolled-back");
    rig.onSpawn = (proc) => proc.exit(0);
    assert.equal(await launcherFor(builtin).run(), 0, "kein Dauerlauf: das Journal ist abgeschlossen");
  });

  it("eine App, die nach einer Wiederherstellung mit Exit 42 endet, bevor sie bestätigt ist, wird zurückgenommen (kein ungeprüfter Neustart im Launcher)", async () => {
    stage("NEU");
    rig.onSpawn = (proc) => proc.exit(RESTART_EXIT_CODE);
    assert.equal(await launcherFor(builtin).run(), RESTART_EXIT_CODE);
    assert.equal(rig.spawned.length, 1);
  });

  it("nimmt eine eingespielte, noch unbestätigte Wiederherstellung nach einem abgebrochenen Start wieder auf", async () => {
    stage("NEU");
    applyPendingRestore(dbFile, data); // Launcher wurde nach dem Austausch, vor der Bestätigung beendet
    rig.healthReplies = [ok];
    const finished = launcherFor(builtin).run();
    for (let i = 0; i < 50 && !readRestoreResult(data); i++) await new Promise((r) => setImmediate(r));
    assert.equal(readRestoreResult(data)?.status, "ok");
    rig.spawned[0].exit(0);
    await finished;
  });
});

describe("Marker des Starters (nur die eingebaute Version wertet sie aus)", () => {
  const install = (version: string, over: Partial<ReturnType<typeof emptyState>> = {}) => {
    meta(volume(version), version);
    writeState({ ...emptyState(), current: version, ...over }, data);
  };
  const failedMarker = (version: string, code = 15, detail = "extra.txt") => writeFileSync(verifyFailedFile(data), `${volume(version)}\n${code}\n${detail}\n`);
  const unclearMarker = (version: string, reason = "signal") => writeFileSync(inconclusiveFile(data), `${version}\n${reason}\n`);

  it("Integritätsbefund ohne Vorversion: Version sperren, Grund merken, die eingebaute App läuft; der Marker wird verbraucht", async () => {
    install("1.1.0");
    failedMarker("1.1.0", 15, "extra.txt");
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1, "die eingebaute App läuft");
    const state = readState(data);
    assert.equal(state.current, null);
    assert.deepEqual(state.failed, ["1.1.0"]);
    assert.equal(state.last?.status, "rolled-back");
    assert.equal(state.last?.reason, "integrity:15");
    assert.equal(state.last?.detail, "extra.txt");
    assert.equal(readActive(data), null, "der Zeiger ist leer");
    assert.equal(existsSync(verifyFailedFile(data)), false);
  });

  it("Rückfall zuerst auf die Vorversion: Exit 42 ohne App-Start, der Zeiger zeigt auf die Vorversion (der Starter prüft sie selbst); erst deren Befund führt zur eingebauten Version", async () => {
    meta(volume("1.0.5"), "1.0.5");
    install("1.1.0", { previous: "1.0.5" });
    failedMarker("1.1.0");
    assert.equal(await launcherFor(builtin).run(), RESTART_EXIT_CODE);
    assert.equal(rig.spawned.length, 0, "kein App-Start: der Starter prüft zuerst die Vorversion");
    assert.equal(readState(data).current, "1.0.5");
    assert.equal(readActive(data), volume("1.0.5"));
    assert.deepEqual(readState(data).failed, ["1.1.0"]);

    // Die Vorversion besteht die Prüfung ebenfalls nicht: jetzt die eingebaute Version, beide gesperrt – die Kette endet
    failedMarker("1.0.5", 16, "server.js");
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
    assert.equal(readState(data).current, null);
    assert.deepEqual(readState(data).failed, ["1.1.0", "1.0.5"]);
    assert.equal(readState(data).last?.reason, "integrity:16");
  });

  it("ungültige Marker (kein Befundcode, Pfad statt Version, Müll) werden ignoriert und verbraucht – der Zustand bleibt", async () => {
    for (const text of ["nur eine Zeile", "../../etc/passwd\n15\nx\n", "1.1.0\n99\nx\n", "1.1.0\nabc\n", "\n\n"]) {
      install("1.1.0", { pending: false });
      writeFileSync(verifyFailedFile(data), text);
      rig.spawned.length = 0;
      await launcherFor(builtin).run();
      assert.equal(existsSync(verifyFailedFile(data)), false, text);
      assert.deepEqual(readState(data).failed, [], text);
    }
  });

  it("steuerzeichenhaltige Pfade aus dem Marker werden bereinigt gespeichert (Log-Injektion)", async () => {
    install("1.1.0");
    writeFileSync(verifyFailedFile(data), `${volume("1.1.0")}\n15\n\u001b[31mrot\u0007${"x".repeat(500)}\n`);
    await launcherFor(builtin).run();
    const detail = readState(data).last?.detail ?? "";
    assert.doesNotMatch(detail, /[\u0000-\u001f]/);
    assert.ok(detail.length <= 200);
  });

  it("unklare Prüfung: die Version bleibt eingetragen und ungesperrt, für diesen Start läuft die eingebaute App; nach dreimal (Signal, Lesefehler) gilt sie als fehlgeschlagen", async () => {
    install("1.1.0", { pending: false });
    for (const count of [1, 2]) {
      unclearMarker("1.1.0", "signal");
      rig.spawned.length = 0;
      assert.equal(await launcherFor(builtin).run(), 0);
      assert.equal(rig.spawned.length, 1, "die eingebaute App läuft");
      const state = readState(data);
      assert.equal(state.current, "1.1.0", "Version bleibt aktuell");
      assert.deepEqual(state.failed, [], "und wird nicht gesperrt");
      assert.equal(state.inconclusive?.count, count);
      assert.equal(existsSync(inconclusiveFile(data)), false, "Marker verbraucht");
    }
    unclearMarker("1.1.0", "io");
    rig.spawned.length = 0;
    await launcherFor(builtin).run();
    const state = readState(data);
    assert.equal(state.current, null);
    assert.deepEqual(state.failed, ["1.1.0"]);
    assert.equal(state.last?.reason, "integrity:17");
    assert.equal(state.inconclusive, null);
  });

  it("Zeitüberschreitung, nicht herstellbarer Ruhezustand und Unbekanntes brennen eine Version nie ein, auch nicht nach zehn Mal", async () => {
    install("1.1.0", { pending: false });
    for (const reason of ["timeout", "quiesce", "other", "fork"]) {
      for (let i = 0; i < 10; i++) {
        unclearMarker("1.1.0", reason);
        rig.spawned.length = 0;
        assert.equal(await launcherFor(builtin).run(), 0, reason);
        assert.equal(rig.spawned.length, 1, "die eingebaute App läuft");
      }
      const state = readState(data);
      assert.equal(state.current, "1.1.0", `${reason}: bleibt aktuell`);
      assert.deepEqual(state.failed, [], `${reason}: nie gesperrt`);
      assert.equal(state.inconclusive?.count, 0);
      assert.equal(state.inconclusive?.reason, reason);
    }
  });

  it("quiesce: die Meldung sagt, dass die Version installiert, aber nicht gestartet wurde", async () => {
    install("1.1.0", { pending: false });
    unclearMarker("1.1.0", "quiesce");
    await launcherFor(builtin).run();
    assert.ok(rig.logs.some((l) => l.includes("installiert, wurde aber nicht gestartet") && l.includes("Ruhezustand")), rig.logs.join("\n"));
  });

  it("die installierte Version setzt den Zähler unklarer Prüfungen zurück, sobald der Starter sie wieder startet", async () => {
    install("1.1.0", { pending: false, inconclusive: { version: "1.1.0", count: 2, at: "t", reason: "signal" } });
    assert.equal(await launcherFor(volume("1.1.0")).run(), 0);
    assert.equal(readState(data).inconclusive, null);
  });

  it("Abgleich mit dem Starter (chooseStart): ein Eintrag, den die eingebaute Version überholt hat, verfällt – ohne Alarm und ohne Marker", async () => {
    install("0.9.0", { pending: false });
    meta(volume("0.8.0"), "0.8.0");
    assert.equal(await launcherFor(builtin).run(), 0);
    const state = readState(data);
    assert.equal(state.current, null);
    assert.equal(state.previous, null);
    assert.deepEqual(state.failed, [], "kein Integritätsbefund");
    assert.equal(state.last, null, "keine Meldung");
    assert.equal(existsSync(volume("0.9.0")), false, "die überholte Version wird aufgeräumt");
    assert.equal(readActive(data), null);
  });

  it("Abgleich: unverträglicher Starter-Vertrag (base) lässt den Eintrag ebenfalls ohne Alarm verfallen", async () => {
    meta(volume("1.1.0"), "1.1.0", 2);
    writeState({ ...emptyState(), current: "1.1.0", pending: false }, data);
    await launcherFor(builtin).run();
    assert.equal(readState(data).current, null);
    assert.deepEqual(readState(data).failed, []);
  });

  it("Abgleich: eine startbare, eingetragene Version, die der Starter übergangen hat, wird nicht gelöscht (nur ein Hinweis)", async () => {
    install("1.1.0", { pending: false });
    await launcherFor(builtin).run();
    assert.equal(readState(data).current, "1.1.0");
    assert.equal(existsSync(volume("1.1.0")), true);
    assert.ok(rig.logs.some((l) => l.includes("der Zustand bleibt unverändert")));
  });
});

describe("Hindernisse unter Markern und Zustandsdateien (die App darf <DATA_DIR>/app beschreiben)", () => {
  const install = (version: string, over: Partial<ReturnType<typeof emptyState>> = {}) => {
    meta(volume(version), version);
    writeState({ ...emptyState(), current: version, ...over }, data);
  };
  /** ein nicht leeres Verzeichnis unter dem Namen einer Datei */
  const obstruct = (file: string) => {
    rmSync(file, { recursive: true, force: true });
    mkdirSync(file, { recursive: true });
    writeFileSync(path.join(file, "x"), "x");
  };

  for (const [label, file] of [
    ["verify-failed", () => verifyFailedFile(data)],
    ["inconclusive", () => inconclusiveFile(data)],
    ["launcher-crash", () => launcherCrashFile(data)],
    ["incompatible", () => incompatibleFile(data)],
  ] as const) {
    it(`${label} als nicht leeres Verzeichnis: die eingebaute App startet trotzdem, das Hindernis wird entfernt`, async () => {
      install("1.1.0", { pending: false });
      obstruct(file());
      assert.equal(await launcherFor(builtin).run(), 0);
      assert.equal(rig.spawned.length, 1, "die App läuft");
      assert.equal(existsSync(file()), false, "das Hindernis wurde entfernt");
    });
  }

  it("state.json als Verzeichnis: gilt als leerer Zustand, die App startet; ein späteres Schreiben legt die Datei neu an", async () => {
    mkdirSync(updatesDir(data), { recursive: true });
    obstruct(path.join(updatesDir(data), "state.json"));
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
    // ein Befund erzwingt das Schreiben des Zustands über dem Hindernis
    meta(volume("1.1.0"), "1.1.0");
    obstruct(path.join(updatesDir(data), "state.json"));
    writeFileSync(verifyFailedFile(data), `1.1.0
15
x
`);
    rig.spawned.length = 0;
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
    assert.equal(readState(data).last?.version, "1.1.0", "Zustand wurde über dem Verzeichnis neu geschrieben");
    assert.equal(readState(data).last?.reason, "integrity:15");
  });

  it("active (der Zeiger) als Verzeichnis: die App startet, der Zeiger wird als Datei neu geschrieben", async () => {
    install("1.1.0", { pending: false });
    obstruct(activeFile(data));
    writeFileSync(verifyFailedFile(data), `1.1.0
16
server.js
`);
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
    assert.equal(readActive(data), null, "leerer Zeiger = eingebaute Version, wieder eine Datei");
    assert.equal(readState(data).current, null);
  });

  it("ein nicht schreibbarer Zustand (hier: <DATA_DIR>/app ist eine Datei) ist nur eine Logzeile", async () => {
    rmSync(updatesDir(data), { recursive: true, force: true });
    writeFileSync(updatesDir(data), "kein Verzeichnis");
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1, "die App startet trotz allem");
  });

  it("<DATA_DIR>/app/versions als Datei: das Aufräumen scheitert leise, die App startet", async () => {
    mkdirSync(updatesDir(data), { recursive: true });
    writeFileSync(path.join(updatesDir(data), "versions"), "keine Versionen");
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
  });
});

describe("Kompatibilitätsschranke (Rückfall auf zu alten Code)", () => {
  const MIGRATION = "20260301000000_neu";
  const BASELINE = "00000000000000_baseline";
  const withMigrations = (dir: string, names: string[]) => {
    for (const name of names) {
      mkdirSync(path.join(dir, "prisma", "migrations", name), { recursive: true });
      writeFileSync(path.join(dir, "prisma", "migrations", name, "migration.sql"), "-- sql");
    }
  };
  const install = (version: string, over: Partial<ReturnType<typeof emptyState>> = {}) => {
    meta(volume(version), version);
    writeState({ ...emptyState(), current: version, ...over }, data);
  };
  const failedMarker = (version: string) => writeFileSync(verifyFailedFile(data), `${volume(version)}\n15\nx\n`);

  it("kennt die Datenbank Migrationen, die die eingebaute Version nicht kennt, und fällt man von einer bewährten Version zurück: gesteuert stoppen statt weiterlaufen", async () => {
    withMigrations(builtin, [BASELINE]);
    install("1.1.0", { pending: false });
    rig.applied = [BASELINE, MIGRATION];
    failedMarker("1.1.0");
    assert.equal(await launcherFor(builtin).run(), INCOMPATIBLE_EXIT_CODE);
    assert.equal(rig.spawned.length, 0, "die App wird nicht gestartet");
    assert.equal(readFileSync(incompatibleFile(data), "utf8"), "1.1.0\n1\n");
    assert.ok(rig.logs.some((l) => l.includes(MIGRATION) && l.includes("Image")), "die Meldung nennt die Migration und was zu tun ist");
    // Der Zustand bleibt, wie er ist: ein neues Image mit der Migration löst es später sauber auf
    assert.equal(readState(data).current, "1.1.0");
    assert.deepEqual(readState(data).failed, []);
  });

  it("ist das Image inzwischen aktualisiert (die eingebaute Version kennt die Migration), startet die App wieder und der Hinweis verschwindet", async () => {
    withMigrations(builtin, [BASELINE, MIGRATION]);
    mkdirSync(path.dirname(incompatibleFile(data)), { recursive: true });
    writeFileSync(incompatibleFile(data), "1.1.0\n1\n");
    rig.applied = [BASELINE, MIGRATION];
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
    assert.equal(existsSync(incompatibleFile(data)), false);
  });

  it("die Rücknahme eines noch unbestätigten Updates (pending) ist der vorgesehene Weg und bleibt erlaubt: Migrationen sind additiv", async () => {
    withMigrations(builtin, [BASELINE]);
    install("1.1.0", { pending: true });
    rig.applied = [BASELINE, MIGRATION];
    failedMarker("1.1.0");
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
    assert.equal(existsSync(incompatibleFile(data)), false);
  });

  it("maßgeblich ist der Code, auf den zurückgefallen wird: kennt die Vorversion die Migration, geht der Rückfall dorthin (Exit 42), sonst wird gestoppt", async () => {
    withMigrations(builtin, [BASELINE]);
    meta(volume("1.0.5"), "1.0.5");
    withMigrations(volume("1.0.5"), [BASELINE, MIGRATION]);
    install("1.1.0", { pending: false, previous: "1.0.5" });
    rig.applied = [BASELINE, MIGRATION];
    failedMarker("1.1.0");
    assert.equal(await launcherFor(builtin).run(), RESTART_EXIT_CODE, "die Vorversion kennt die Migration");
    assert.equal(readState(data).current, "1.0.5");

    // Vorversion kennt sie nicht
    withMigrations(volume("1.0.4"), [BASELINE]);
    meta(volume("1.0.4"), "1.0.4");
    writeState({ ...emptyState(), current: "1.1.0", previous: "1.0.4", pending: false }, data);
    failedMarker("1.1.0");
    assert.equal(await launcherFor(builtin).run(), INCOMPATIBLE_EXIT_CODE);
  });

  it("ist die Datenbank nicht lesbar (null), gibt es kein Urteil: die Schranke verhindert keinen Start, den die App selbst prüft", async () => {
    withMigrations(builtin, [BASELINE]);
    install("1.1.0", { pending: false });
    rig.applied = null;
    failedMarker("1.1.0");
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 1);
  });

  it("auch der Absturz-Marker des Starters (Launcher einer bewährten Version stürzt wiederholt ab) läuft durch die Schranke", async () => {
    withMigrations(builtin, [BASELINE]);
    install("1.1.0", { pending: false });
    rig.applied = [BASELINE, MIGRATION];
    writeFileSync(launcherCrashFile(data), `${volume("1.1.0")}\n`);
    assert.equal(await launcherFor(builtin).run(), INCOMPATIBLE_EXIT_CODE);
    assert.equal(rig.spawned.length, 0);
  });
});
