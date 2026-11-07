import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { applyPendingRestore, pendingDbFile, readApplied, readRestoreResult, restoreDir, writePending } from "../lib/updates/restore";
import { RESTART_EXIT_CODE, emptyState } from "../lib/updates/state";
import { launcherCrashFile, readState, versionDir, writeState } from "../lib/updates/store";
import { createLauncher, DEFAULT_HEALTH_MAX_MS, type AppProcess, type LauncherConfig, type LauncherDeps, type SpawnSpec } from "./launcher";

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
  meta(builtin, "1.0.0");
  rig = { spawned: [], logs: [], clock: { ms: Date.parse("2026-01-01T00:00:00Z") }, onSpawn: (proc) => proc.exit(0), healthReplies: [], healthCalls: 0 };
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

  it("startet die App nach Neustart-Wunsch (Exit 42) im selben Launcher neu, solange der Zeiger nicht wechselt", async () => {
    rig.onSpawn = (proc, index) => proc.exit(index === 0 ? RESTART_EXIT_CODE : 0);
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 2);
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

  it("setzt die vorherige Datenbank zurück, wenn die wiederhergestellte nicht gesund startet, und startet dann neu", async () => {
    stage("KAPUTT");
    // erster Start: nie gesund; zweiter Start (nach dem Zurücksetzen): endet normal
    rig.onSpawn = (proc, index) => {
      if (index === 1) proc.exit(0);
    };
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(rig.spawned.length, 2);
    assert.deepEqual(rig.spawned[0].kills, ["SIGKILL"]);
    assert.equal(readFileSync(dbFile, "utf8"), "DB", "die vorherige Datenbank ist wieder da");
    assert.equal(readRestoreResult(data)?.status, "rolled-back");
  });

  it("setzt zurück, wenn der Prozess nach dem Einspielen sofort endet (z. B. Migration scheitert)", async () => {
    stage("KAPUTT");
    rig.onSpawn = (proc, index) => proc.exit(index === 0 ? 1 : 0);
    assert.equal(await launcherFor(builtin).run(), 0);
    assert.equal(readFileSync(dbFile, "utf8"), "DB");
    assert.equal(readRestoreResult(data)?.status, "rolled-back");
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
