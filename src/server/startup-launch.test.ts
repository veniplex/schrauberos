import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { installFakes } from "@/test/harness";
import { startInBackground } from "./startup-launch";

/**
 * Der Start läuft im Hintergrund (`instrumentation.ts` wartet nicht darauf): Next beantwortet vor dem Ende von `register()` keine einzige Anfrage, auch `/api/health`
 * nicht – der Launcher sähe bei einer langen Migration nur Zeitüberschreitungen. Diese Tests bilden den **echten** Ablauf ab: echtes `startApp` gegen eine frische Datenbank,
 * echte Health-Route, echter Proxy.
 */
describe("startInBackground", () => {
  it("kehrt sofort zurück, auch wenn der Start lange dauert; ein Fehler beim Start beendet den Prozess (nie dauerhaft „starting“)", async () => {
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    const exits: number[] = [];
    const logs: string[] = [];
    let done = false;
    const running = startInBackground({ run: () => slow, exit: (c) => void exits.push(c), log: (m) => void logs.push(m) }).then(() => (done = true));
    await new Promise((r) => setImmediate(r));
    assert.equal(done, false, "der Start läuft noch");
    finish();
    await running;
    assert.equal(exits.length, 0);

    const failed = startInBackground({
      run: async () => {
        throw new Error("Import kaputt");
      },
      exit: (c) => void exits.push(c),
      log: (m) => void logs.push(m),
    });
    await failed;
    assert.deepEqual(exits, [1]);
    assert.ok(logs.some((l) => l.includes("Start fehlgeschlagen")));
  });
});

describe("Start mit echter Datenbank: Health und Proxy während der Migration", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "so-launch-"));
  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows: die Datenbankdatei ist bis zum Prozessende geöffnet */
    }
  });

  it("solange gestartet wird: /api/health antwortet 503 „starting“ und der Proxy sperrt jede andere Anfrage; danach „ok“ und freie Fahrt", async () => {
    installFakes();
    process.env.DATA_DIR = dir;
    process.env.DATABASE_URL = `file:${path.join(dir, "schrauberos.db")}`;
    const { startApp } = await import("./startup");
    const { startupState } = await import("./startup-state");
    const { GET } = await import("@/app/api/health/route");
    const { proxy } = await import("@/proxy");
    const { jobRunner } = await import("@/server/jobs");

    const page = () => new NextRequest("http://localhost:3000/customers", { headers: { cookie: "so_session=abc" } });
    assert.equal(startupState().status, "starting");

    // Der Start beginnt (nicht abwarten): Migrationen laufen, die Datenbank ist noch nicht fertig
    const starting = startApp();
    assert.equal(startupState().status, "starting");
    const health = await GET();
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { status: "starting" });
    // Jede Anfrage – Seite, Server Action, Route Handler – bekommt 503, ohne die Datenbank zu berühren
    const blocked = proxy(page());
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers.get("x-middleware-next"), null);
    const action = proxy(new NextRequest("http://localhost:3000/customers", { method: "POST", headers: { "next-action": "abc", cookie: "so_session=abc" } }));
    assert.equal(action.status, 503);
    assert.deepEqual(await action.json(), { status: "starting" });
    // Der Launcher wertet genau diese Antwort als „lebt, migriert noch“
    const { isStarting } = await import("@/lib/updates/health");
    assert.equal(isStarting(health.status, { status: "starting" }), true);

    try {
      await starting;
      assert.equal(startupState().status, "ready");
      const ok = await GET();
      assert.equal(ok.status, 200);
      assert.equal(proxy(page()).headers.get("x-middleware-next"), "1", "nach dem Start läuft alles durch");
      assert.equal(jobRunner().status().started, true, "der Job-Runner läuft erst nach dem Start");
    } finally {
      jobRunner().stop();
    }
  });
});
