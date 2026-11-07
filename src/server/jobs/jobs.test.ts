import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import fsp from "node:fs/promises";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { validateSchedule } from "@/lib/jobs/schedule";
import { FEATURES } from "@/modules/catalog";
import { featureKey } from "@/modules/catalog-logic";
import { createTestEnv, type TestEnv } from "@/test/harness";
import type { JobDef, OutboxHandlerDef } from "./types";

/**
 * Job-Runner gegen eine echte temporäre Datenbank mit Fake-Uhr: Zeitplan (auch Sommerzeit), Wiederholung mit Wartezeit, Sperre gegen Doppelläufe,
 * Neustart mitten im Lauf, Zeitüberschreitung, Aktivierung der Funktion, Outbox-Zustellung (idempotent, Wiederholung, Aufgeben, Aufräumen) und die echten Jobs
 * der Plattform und der Funktionen (Registry, Backup-Fehler sichtbar).
 */
let env: TestEnv;
let runnerModule: typeof import("./runner");
let outbox: typeof import("./outbox");
let registry: typeof import("./registry");
let maintenance: typeof import("./maintenance");
let status: typeof import("./status");

before(async () => {
  env = await createTestEnv();
  runnerModule = await import("./runner");
  outbox = await import("./outbox");
  registry = await import("./registry");
  maintenance = await import("./maintenance");
  status = await import("./status");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.jobRun.deleteMany();
  await env.db.jobState.deleteMany();
  await env.db.outboxDelivery.deleteMany();
  await env.db.outboxEvent.deleteMany();
  await env.db.featureSetting.deleteMany();
  await env.db.auditLog.deleteMany();
});

/** Fake-Uhr */
function clock(start: string) {
  let ms = Date.parse(start);
  return { now: () => new Date(ms), advance: (by: number) => void (ms += by), set: (iso: string) => void (ms = Date.parse(iso)) };
}

const MIN = 60_000;
const BERLIN = () => "Europe/Berlin";

/** Wartet auf eine Bedingung (Abfrage in kurzen Abständen, höchstens ~5 s) – statt eine feste Zeit zu schlafen. */
async function until(condition: () => boolean | Promise<boolean>, what = "Bedingung"): Promise<void> {
  for (let i = 0; i < 5000; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`${what} trat nicht ein`);
}

function rig(jobs: JobDef[], start = "2026-06-01T10:00:00Z", extra: Partial<Parameters<typeof runnerModule.createJobRunner>[0]> = {}) {
  const c = clock(start);
  const runner = runnerModule.createJobRunner({ jobs: () => jobs, now: c.now, timeZone: BERLIN, ...extra });
  return { c, runner };
}

const counting = (result?: string) => {
  const fn = Object.assign(
    async () => {
      fn.calls++;
      return result;
    },
    { calls: 0 },
  );
  return fn;
};

describe("Registry: alle Jobs sind sauber angemeldet", () => {
  it("IDs eindeutig, Zeitpläne gültig, Funktionen im Katalog, Abnehmer eindeutig", async () => {
    const jobs = registry.allJobs();
    assert.ok(jobs.length >= 6, "Plattform- und Funktions-Jobs sind da");
    assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length, "doppelte Job-ID");
    const known = new Set(FEATURES.map(featureKey));
    for (const job of jobs) {
      assert.match(job.id, /^[a-z]+\.[a-z-]+$/, job.id);
      assert.doesNotThrow(() => validateSchedule(job.schedule), job.id);
      if (job.feature) assert.ok(known.has(job.feature), `${job.id}: unbekannte Funktion ${job.feature}`);
    }
    // Per Import (nicht per Quelltext-Suche): Jeder Job und jeder Abnehmer einer Funktion nennt seine Funktion – sonst liefe er auch bei ausgeschalteter Funktion
    const { featureJobs, featureOutboxHandlers } = await import("@/modules/jobs");
    assert.ok(featureJobs.length > 0);
    assert.deepEqual(featureJobs.filter((j) => !j.feature).map((j) => j.id), []);
    assert.deepEqual(featureOutboxHandlers.filter((h) => !h.feature).map((h) => h.id), []);
    const handlers = registry.allOutboxHandlers();
    assert.equal(new Set(handlers.map((h) => h.id)).size, handlers.length);
    for (const h of handlers) if (h.feature) assert.ok(known.has(h.feature));
  });
});

describe("Zeitplan und Ausführung", () => {
  it("legt den Zustand an: Intervall-Jobs sind sofort fällig, Cron-Jobs zum nächsten Termin; ein Takt führt nur Fälliges aus und merkt sich das Ergebnis", async () => {
    const every = counting("fertig");
    const daily = counting();
    const { c, runner } = rig([
      { id: "test.every", schedule: { every: 10 * MIN }, run: every },
      { id: "test.daily", schedule: { cron: "0 3 * * *" }, run: daily },
    ]);
    await runner.sync();
    const states = new Map((await env.db.jobState.findMany()).map((s) => [s.id, s]));
    assert.equal(states.get("test.every")!.nextRunAt!.toISOString(), "2026-06-01T10:00:00.000Z");
    assert.equal(states.get("test.daily")!.nextRunAt!.toISOString(), "2026-06-02T01:00:00.000Z", "03:00 Uhr Berlin (Sommerzeit) = 01:00 UTC");

    const results = await runner.tick();
    assert.deepEqual(results.map((r) => [r.jobId, r.status, r.message]), [["test.every", "ok", "fertig"]]);
    assert.equal(every.calls, 1);
    assert.equal(daily.calls, 0);
    const after = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.every" } });
    assert.equal(after.lastStatus, "ok");
    assert.equal(after.lastMessage, "fertig");
    assert.equal(after.failures, 0);
    assert.equal(after.lockedUntil, null);
    assert.equal(after.nextRunAt!.toISOString(), "2026-06-01T10:10:00.000Z");
    const run = await env.db.jobRun.findFirstOrThrow({ where: { jobId: "test.every" } });
    assert.deepEqual([run.status, run.attempt, run.message], ["ok", 1, "fertig"]);

    assert.deepEqual(await runner.tick(), [], "noch nicht wieder fällig");
    c.advance(10 * MIN);
    assert.equal((await runner.tick()).length, 1);
    assert.equal(every.calls, 2);
    c.set("2026-06-02T01:00:00Z");
    assert.deepEqual((await runner.tick()).map((r) => r.jobId).sort(), ["test.daily", "test.every"]);
  });

  it("holt einen verpassten Lauf nach dem Stillstand genau einmal nach", async () => {
    const job = counting();
    const { c, runner } = rig([{ id: "test.daily", schedule: { cron: "0 3 * * *" }, run: job }]);
    await runner.sync();
    c.set("2026-06-05T12:00:00Z"); // App war vier Tage aus
    assert.equal((await runner.tick()).length, 1);
    assert.equal((await runner.tick()).length, 0);
    assert.equal(job.calls, 1);
    assert.equal((await env.db.jobState.findUniqueOrThrow({ where: { id: "test.daily" } })).nextRunAt!.toISOString(), "2026-06-06T01:00:00.000Z");
  });

  it("Sommerzeit: ein Tagesjob um 02:30 läuft an jedem Tag der Umstellungswochen genau einmal", async () => {
    const job = counting();
    const { c, runner } = rig([{ id: "test.dst", schedule: { cron: "30 2 * * *" }, run: job }], "2026-03-26T12:00:00Z");
    await runner.sync();
    const days: string[] = [];
    // zehn Tage in 10-Minuten-Schritten durchtakten (Uhrzeit läuft über die Umstellung am 29.3.)
    for (let i = 0; i < 10 * 24 * 6; i++) {
      c.advance(10 * MIN);
      for (const r of await runner.tick()) days.push(`${r.jobId}@${c.now().toISOString()}`);
    }
    assert.equal(days.length, 10, days.join("\n"));
    assert.ok(days.some((d) => d.includes("2026-03-29T01:30")), "am Umstellungstag um 03:30 Sommerzeit = 01:30 UTC, nicht ausgelassen");
  });

  it("zwei Takte gleichzeitig: der Job läuft nur einmal (Sperre)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const { runner } = rig([
      {
        id: "test.slow",
        schedule: { every: MIN },
        run: async () => {
          calls++;
          await gate;
        },
      },
    ]);
    await runner.sync();
    const first = runner.tick();
    await until(() => runner.isRunning("test.slow"), "Job läuft");
    assert.equal(runner.isRunning("test.slow"), true);
    assert.deepEqual(await runner.tick(), [], "während des Laufs startet kein zweiter");
    release();
    assert.equal((await first).length, 1);
    assert.equal(calls, 1);
  });

  it("ein zweiter Runner (zweiter Prozess) kann einen gesperrten Job nicht übernehmen; nach Ablauf der Sperre schon", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: JobDef = { id: "test.lock", schedule: { every: MIN }, timeoutMs: 5 * MIN, run: () => gate };
    const a = rig([slow]);
    const calls = counting();
    const b = rig([{ ...slow, run: calls }]);
    b.c.set("2026-06-01T10:00:00Z");
    await a.runner.sync();
    const running = a.runner.tick();
    await until(() => a.runner.isRunning("test.lock"), "Job läuft");
    assert.deepEqual(await b.runner.tick(), [], "gesperrt");
    assert.equal(calls.calls, 0);
    b.c.advance(5 * MIN + 61_000); // Sperre (Zeitlimit + Reserve) abgelaufen
    assert.equal((await b.runner.tick()).length, 1);
    release();
    await running;
  });

  it("Neustart mitten im Lauf: recover() schließt den Lauf als unterbrochen ab, löst die Sperre und stellt den Job sofort wieder fällig", async () => {
    const hang = new Promise<void>(() => undefined); // endet nie – der „alte Prozess“ ist weg
    const old = rig([{ id: "test.restart", schedule: { cron: "0 3 * * *" }, run: () => hang }]);
    await old.runner.sync();
    await env.db.jobState.update({ where: { id: "test.restart" }, data: { nextRunAt: old.c.now() } });
    void old.runner.tick();
    await until(async () => (await env.db.jobState.findUniqueOrThrow({ where: { id: "test.restart" } })).lockedUntil !== null, "Sperre gesetzt");
    assert.equal(await env.db.jobRun.count({ where: { jobId: "test.restart" } }), 0, "ein laufender Job schreibt erst am Ende einen Lauf");

    const job = counting("nachgeholt");
    const fresh = rig([{ id: "test.restart", schedule: { cron: "0 3 * * *" }, run: job }]);
    assert.equal(await fresh.runner.recover(), 1);
    const run = await env.db.jobRun.findFirstOrThrow({ where: { jobId: "test.restart" } });
    assert.deepEqual([run.status, run.message], ["interrupted", "Neustart während des Laufs"]);
    const state = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.restart" } });
    assert.equal(state.lockedUntil, null);
    assert.equal(state.lastStatus, "interrupted");
    assert.equal((await fresh.runner.tick()).length, 1, "wird gleich beim ersten Takt wieder aufgenommen");
    assert.equal(job.calls, 1);
    assert.equal((await env.db.jobState.findUniqueOrThrow({ where: { id: "test.restart" } })).lastStatus, "ok");
  });

  it("Zeitüberschreitung: der Lauf gilt als Fehler, das Signal wird ausgelöst, der Job startet erst wieder, wenn die Funktion zurückgekehrt ist", async () => {
    let aborted = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runner, c } = rig([
      {
        id: "test.timeout",
        schedule: { every: 1000 },
        timeoutMs: 40,
        retry: { baseDelayMs: 1000, maxDelayMs: 1000 },
        run: async ({ signal }) => {
          signal.addEventListener("abort", () => (aborted = true));
          await gate;
        },
      },
    ]);
    await runner.sync();
    const [result] = await runner.tick();
    assert.deepEqual([result.status, result.message], ["error", "Zeitüberschreitung"]);
    assert.equal(aborted, true);
    assert.equal(runner.isRunning("test.timeout"), true, "die Funktion läuft noch");
    c.advance(5000);
    assert.deepEqual(await runner.tick(), [], "kein zweiter Lauf, solange der erste hängt");
    // …aber sichtbar: Vermerk am Job, die Fehlerserie wächst, der nächste Termin rückt nach der Wartezeit weiter
    const stuck = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.timeout" } });
    assert.match(stuck.lastMessage ?? "", /Hängt/);
    assert.equal(stuck.failures, 2);
    assert.equal(stuck.lastStatus, "error");
    release();
    await until(() => !runner.isRunning("test.timeout"), "Funktion zurückgekehrt");
    assert.equal(runner.isRunning("test.timeout"), false);
    c.advance(5000);
    assert.equal((await runner.tick()).length, 1);
  });

  it("eine ausgeschaltete Funktion ruht (kein Lauf, kein Eintrag) und wird beim Wiedereinschalten nachgeholt", async () => {
    const job = counting();
    const { runner } = rig([{ id: "test.fleet", feature: "office.fleet", schedule: { every: MIN }, run: job }]);
    await runner.sync();
    await env.db.featureSetting.create({ data: { key: "office.fleet", enabled: false, updatedByName: "t" } });
    assert.deepEqual(await runner.tick(), []);
    assert.equal(await env.db.jobRun.count(), 0);
    assert.equal(await runner.runNow("test.fleet"), null, "auch „jetzt ausführen“ respektiert die Aktivierung");
    await env.db.featureSetting.deleteMany();
    assert.equal((await runner.tick()).length, 1);
    assert.equal(job.calls, 1);
  });

  it("Plattform-Jobs ohne Funktion laufen immer; ungültige Zeitpläne und doppelte IDs werden übersprungen, die übrigen laufen", async () => {
    const ok = counting();
    const originalError = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => void logged.push(args.join(" "));
    try {
      const { runner } = rig([
        { id: "test.bad", schedule: { cron: "kaputt" }, run: counting() },
        { id: "test.ok", schedule: { every: MIN }, run: ok },
        { id: "test.ok", schedule: { every: MIN }, run: counting() },
      ]);
      await runner.sync();
      assert.equal((await runner.tick()).length, 1);
    } finally {
      console.error = originalError;
    }
    assert.equal(ok.calls, 1);
    assert.equal(await env.db.jobState.count({ where: { id: "test.bad" } }), 0);
    assert.ok(logged.some((l) => l.includes("test.bad")) && logged.some((l) => l.includes("doppelt")));
  });
});

describe("Fehler und Wiederholung mit Wartezeit", () => {
  it("verdoppelt die Wartezeit je Fehlschlag bis zur Obergrenze, zeigt den Fehler (ohne Nutzdaten) und setzt nach einem Erfolg zurück", async () => {
    let fail = true;
    const originalError = console.error;
    console.error = () => undefined;
    const { c, runner } = rig([
      {
        id: "test.flaky",
        schedule: { cron: "0 3 * * *" },
        retry: { baseDelayMs: MIN, maxDelayMs: 5 * MIN },
        run: async ({ attempt }) => {
          if (fail) throw Object.assign(new Error("Passwort hunter2 falsch"), { code: "EBUSY" });
          return `Versuch ${attempt}`;
        },
      },
    ]);
    try {
      await runner.sync();
      await env.db.jobState.update({ where: { id: "test.flaky" }, data: { nextRunAt: c.now() } });
      const waits: number[] = [];
      for (let i = 0; i < 6; i++) {
        const [r] = await runner.tick();
        assert.equal(r.status, "error");
        assert.equal(r.attempt, i + 1);
        const s = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.flaky" } });
        assert.equal(s.failures, i + 1);
        assert.equal(s.lastStatus, "error");
        assert.equal(s.lastMessage, "Error EBUSY", "nur Art und Code, nie der Meldungstext");
        waits.push(s.nextRunAt!.getTime() - c.now().getTime());
        c.advance(waits[i] - 1);
        assert.deepEqual(await runner.tick(), [], "vor Ablauf der Wartezeit nichts");
        c.advance(1);
      }
      assert.deepEqual(waits.map((w) => w / MIN), [1, 2, 4, 5, 5, 5]);
      fail = false;
      const [ok] = await runner.tick();
      assert.deepEqual([ok.status, ok.message, ok.attempt], ["ok", "Versuch 7", 7]);
      const s = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.flaky" } });
      assert.equal(s.failures, 0);
      assert.equal(s.nextRunAt!.toISOString() > c.now().toISOString(), true, "danach wieder nach regulärem Zeitplan");
      assert.equal(await env.db.jobRun.count({ where: { status: "error" } }), 6);
    } finally {
      console.error = originalError;
    }
  });

  it("Audit-Aufbewahrung: scheitert der Lauf, versucht der Runner es nach der Wartezeit wieder (nicht erst am nächsten Tag)", async () => {
    const job = registry.allJobs().find((j) => j.id === "audit.retention")!;
    await env.db.auditLog.create({ data: { action: "user.create", actorName: "x", createdAt: new Date(Date.now() - 800 * 86_400_000) } });
    await env.db.$executeRawUnsafe(`CREATE TRIGGER "test_block_audit_delete" BEFORE DELETE ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'blockiert'); END`);
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const { c, runner } = rig([job], new Date().toISOString());
      await runner.sync();
      await env.db.jobState.update({ where: { id: job.id }, data: { nextRunAt: c.now() } });
      assert.equal((await runner.tick())[0].status, "error");
      await env.db.$executeRawUnsafe('DROP TRIGGER "test_block_audit_delete"');
      const failed = await env.db.jobState.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(failed.failures, 1);
      c.advance(failed.nextRunAt!.getTime() - c.now().getTime());
      const [retry] = await runner.tick();
      assert.equal(retry.status, "ok");
      assert.equal(retry.message, "1 gelöscht");
      assert.equal((await env.db.jobState.findUniqueOrThrow({ where: { id: job.id } })).failures, 0);
    } finally {
      console.error = originalError;
      await env.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_block_audit_delete"');
    }
  });

  it("automatisches Backup, das scheitert, ist sichtbar (Fehlerstatus, Versuche) und wird mit Wartezeit wiederholt; im Audit steht nur der erste Fehlschlag", async () => {
    const job = registry.allJobs().find((j) => j.id === "backup.auto")!;
    // Unmöglich zu beschreiben: „backups“ ist eine Datei statt eines Ordners
    writeFileSync(path.join(env.dir, "backups"), "im Weg");
    await env.db.appSetting.upsert({ where: { key: "backup.hour" }, update: { value: "0" }, create: { key: "backup.hour", value: "0" } });
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const { c, runner } = rig([job], "2026-06-01T10:00:00Z", { timeZone: () => "UTC" });
      await runner.sync();
      const first = (await runner.tick())[0];
      assert.equal(first.status, "error");
      let state = (await status.jobStateOf("backup.auto"))!;
      assert.equal(state.failures, 1);
      assert.equal(state.lastStatus, "error");
      assert.equal(state.nextRunAt!.getTime() - c.now().getTime(), 15 * MIN, "erste Wiederholung nach 15 Minuten");
      c.advance(15 * MIN);
      assert.equal((await runner.tick())[0].status, "error");
      state = (await status.jobStateOf("backup.auto"))!;
      assert.equal(state.failures, 2);
      assert.equal(state.nextRunAt!.getTime() - c.now().getTime(), 30 * MIN, "zweite nach 30 Minuten");
      assert.equal(await env.db.auditLog.count({ where: { action: "backup.createFailed" } }), 1, "nur der erste Fehlschlag der Serie");
    } finally {
      console.error = originalError;
      const { rmSync } = await import("node:fs");
      rmSync(path.join(env.dir, "backups"), { force: true });
    }
  });
});

describe("Outbox-Zustellung", () => {
  const event = (type: string, extra: Record<string, unknown> = {}) => env.db.outboxEvent.create({ data: { type, entityId: "e1", payload: JSON.stringify({ n: 1 }), availableAt: new Date("2000-01-01T00:00:00Z"), ...extra } });
  const handler = (id: string, types: string[], handle: OutboxHandlerDef["handle"], extra: Partial<OutboxHandlerDef> = {}): OutboxHandlerDef => ({ id, types, handle, ...extra });
  const deliver = (handlers: OutboxHandlerDef[], now: Date, active: string[] = []) => outbox.deliverOutbox({ handlers, activeFeatures: new Set(active), now });

  it("stellt an passende Abnehmer zu (exakt, Präfix, alle), mit Nutzdaten und ID, und markiert das Ereignis als erledigt", async () => {
    const seen: string[] = [];
    const a = handler("t.a", ["invoice.paid"], async (m) => void seen.push(`a:${m.type}:${m.entityId}:${JSON.stringify(m.payload)}:${m.attempt}`));
    const b = handler("t.b", ["invoice.*"], async (m) => void seen.push(`b:${m.type}`));
    const c = handler("t.c", ["customer.*"], async () => void seen.push("c"));
    const e = await event("invoice.paid");
    const summary = await deliver([a, b, c], new Date());
    assert.deepEqual(summary, { delivered: 1, retried: 0, failed: 0, skipped: 0, parked: 0 });
    assert.deepEqual(seen.sort(), ['a:invoice.paid:e1:{"n":1}:1', "b:invoice.paid"]);
    const row = await env.db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    assert.ok(row.processedAt);
    assert.equal(row.attempts, 1);
    assert.equal(await env.db.outboxDelivery.count({ where: { eventId: e.id } }), 2);
    assert.equal((await deliver([a, b], new Date())).delivered, 0, "erledigte Ereignisse kommen nicht wieder");
    assert.equal(seen.length, 2);
  });

  it("ein fehlschlagender Abnehmer wird mit Wartezeit wiederholt; der bereits gelungene wird nicht noch einmal bedient (idempotent)", async () => {
    let good = 0;
    let bad = 0;
    let broken = true;
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const ok = handler("t.ok", ["x.*"], async () => void good++);
      const flaky = handler("t.flaky", ["x.*"], async () => {
        bad++;
        if (broken) throw Object.assign(new Error("Server antwortet mit geheim"), { code: "ECONNRESET" });
      });
      const e = await event("x.y");
      const t0 = new Date("2026-06-01T10:00:00Z");
      assert.deepEqual(await deliver([ok, flaky], t0), { delivered: 0, retried: 1, failed: 0, skipped: 0, parked: 0 });
      let row = await env.db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
      assert.equal(row.processedAt, null);
      assert.equal(row.attempts, 1);
      assert.equal(row.lastError, "t.flaky: Error ECONNRESET", "nur Abnehmer, Art und Code");
      assert.equal(row.availableAt.toISOString(), "2026-06-01T10:00:30.000Z", "erste Wartezeit 30 s");
      assert.equal((await deliver([ok, flaky], new Date("2026-06-01T10:00:10Z"))).retried, 0, "noch in der Wartezeit");
      broken = false;
      assert.deepEqual(await deliver([ok, flaky], new Date("2026-06-01T10:00:31Z")), { delivered: 1, retried: 0, failed: 0, skipped: 0, parked: 0 });
      assert.deepEqual([good, bad], [1, 2], "der erste Abnehmer wurde nur einmal bedient");
      row = await env.db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
      assert.ok(row.processedAt);
      assert.equal(row.lastError, null);
    } finally {
      console.error = originalError;
    }
  });

  it("gibt nach den erlaubten Versuchen auf (failedAt) und versucht es dann nicht mehr; ein defektes Ereignis blockiert die anderen nicht", async () => {
    const originalError = console.error;
    console.error = () => undefined;
    try {
      let calls = 0;
      const boom = handler(
        "t.boom",
        ["bad.*"],
        async () => {
          calls++;
          throw new Error("x");
        },
        { maxAttempts: 3 },
      );
      const fine = handler("t.fine", ["good.*"], async () => undefined);
      const bad = await event("bad.one", { createdAt: new Date("2026-06-01T09:00:00Z") });
      const good = await event("good.one");
      let now = new Date("2026-06-01T10:00:00Z");
      const outcomes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const s = await deliver([boom, fine], now);
        outcomes.push(s.retried * 10 + s.failed);
        now = new Date(now.getTime() + 2 * 60 * 60_000);
      }
      assert.deepEqual(outcomes, [10, 10, 1, 0], "zweimal wiederholt, dann aufgegeben, danach ruhig");
      assert.equal(calls, 3);
      const row = await env.db.outboxEvent.findUniqueOrThrow({ where: { id: bad.id } });
      assert.ok(row.failedAt);
      assert.equal(row.processedAt, null);
      assert.equal(row.attempts, 3);
      assert.ok((await env.db.outboxEvent.findUniqueOrThrow({ where: { id: good.id } })).processedAt, "das gute Ereignis wurde zugestellt");
    } finally {
      console.error = originalError;
    }
  });

  it("ohne angemeldeten Abnehmer gilt das Ereignis als erledigt", async () => {
    const other = handler("t.other", ["customer.*"], async () => undefined);
    await event("nobody.cares");
    assert.deepEqual(await deliver([other], new Date(), []), { delivered: 0, retried: 0, failed: 0, skipped: 1, parked: 0 });
  });

  it("Abnehmer einer ausgeschalteten Funktion: das Ereignis bleibt offen (geparkt), wird beim Einschalten nachgeholt und verfällt sonst mit der Aufbewahrung", async () => {
    let calls = 0;
    const fleet = handler("t.fleet", ["fleet.*"], async () => void calls++, { feature: "office.fleet" });
    const t0 = new Date("2026-06-01T10:00:00Z");
    const e = await event("fleet.changed");
    assert.deepEqual(await deliver([fleet], t0, []), { delivered: 0, retried: 0, failed: 0, skipped: 0, parked: 1 });
    assert.equal(calls, 0, "ausgeschaltet: nicht gerufen");
    let row = await env.db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    assert.equal(row.processedAt, null, "bleibt offen");
    assert.equal(row.availableAt.toISOString(), "2026-06-01T10:15:00.000Z", "geparkt: erst in 15 Minuten wieder angesehen (verdrängt keine neuen Ereignisse)");
    assert.equal((await deliver([fleet], new Date("2026-06-01T10:05:00Z"), [])).parked, 0, "in der Wartezeit nicht erneut angefasst");

    // Funktion wieder an: nachgeholt
    assert.equal((await deliver([fleet], new Date("2026-06-01T10:16:00Z"), ["office.fleet"])).delivered, 1);
    assert.equal(calls, 1);
    row = await env.db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    assert.ok(row.processedAt);
  });

  it("gemischt: der aktive Abnehmer wird sofort bedient, für den ausgeschalteten bleibt das Ereignis offen; ein geparktes Ereignis verdrängt neue nicht", async () => {
    const seen: string[] = [];
    const active = handler("t.active", ["x.*"], async () => void seen.push("active"));
    const off = handler("t.off", ["x.*"], async () => void seen.push("off"), { feature: "office.fleet" });
    const first = await event("x.one", { createdAt: new Date("2026-06-01T09:00:00Z") });
    const t0 = new Date("2026-06-01T10:00:00Z");
    assert.equal((await deliver([active, off], t0, [])).parked, 1);
    assert.deepEqual(seen, ["active"]);
    assert.equal(await env.db.outboxDelivery.count({ where: { eventId: first.id, handler: "t.active" } }), 1);
    // ein neues Ereignis wird trotz des älteren, geparkten zugestellt
    await event("x.two");
    assert.equal((await deliver([active, off], new Date("2026-06-01T10:01:00Z"), [])).parked, 1);
    assert.deepEqual(seen, ["active", "active"]);
    // Funktion an: für das erste Ereignis kommt nur noch der ausgeschaltete Abnehmer dran
    await deliver([active, off], new Date("2026-06-01T10:20:00Z"), ["office.fleet"]);
    assert.deepEqual(seen.sort(), ["active", "active", "off", "off"]);
    assert.ok((await env.db.outboxEvent.findUniqueOrThrow({ where: { id: first.id } })).processedAt);
  });

  it("ein hängender Abnehmer wird nach seinem Zeitlimit als gescheitert gewertet (Signal ausgelöst) und blockiert weder die übrigen Abnehmer noch den Job", async () => {
    const originalError = console.error;
    console.error = () => undefined;
    try {
      let aborted = false;
      const hang = handler(
        "t.hang",
        ["x.*"],
        (_message, { signal }) => {
          signal.addEventListener("abort", () => (aborted = true));
          return new Promise<void>(() => undefined); // kehrt nie zurück
        },
        { timeoutMs: 20 },
      );
      const fine = handler("t.fine", ["x.*"], async () => undefined);
      const e = await event("x.y");
      const summary = await deliver([hang, fine], new Date("2026-06-01T10:00:00Z"));
      assert.deepEqual(summary, { delivered: 0, retried: 1, failed: 0, skipped: 0, parked: 0 });
      assert.equal(aborted, true);
      const row = await env.db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
      assert.equal(row.lastError, "t.hang: Error", "als Fehler vermerkt (nur Art, keine Daten)");
      assert.equal(await env.db.outboxDelivery.count({ where: { eventId: e.id, handler: "t.fine" } }), 1, "der andere Abnehmer wurde bedient");
    } finally {
      console.error = originalError;
    }
  });

  it("wird der Job abgebrochen (signal), hört die Zustellung nach dem laufenden Ereignis auf", async () => {
    const seen: string[] = [];
    const h = handler("t.h", ["x.*"], async (m) => void seen.push(m.type));
    await event("x.one", { createdAt: new Date("2026-06-01T09:00:00Z") });
    await event("x.two", { createdAt: new Date("2026-06-01T09:01:00Z") });
    const controller = new AbortController();
    controller.abort();
    const summary = await outbox.deliverOutbox({ handlers: [h], activeFeatures: new Set(), now: new Date(), signal: controller.signal });
    assert.deepEqual(summary, { delivered: 0, retried: 0, failed: 0, skipped: 0, parked: 0 });
    assert.deepEqual(seen, []);
  });

  it("hasPendingOutbox: nur zustellbare Ereignisse zählen (nicht erledigte, aufgegebene oder in der Wartezeit)", async () => {
    const now = new Date("2026-06-01T10:00:00Z");
    assert.equal(await outbox.hasPendingOutbox(now), false);
    await env.db.outboxEvent.create({ data: { type: "t.a", processedAt: now } });
    await env.db.outboxEvent.create({ data: { type: "t.b", failedAt: now } });
    await env.db.outboxEvent.create({ data: { type: "t.c", availableAt: new Date(now.getTime() + MIN) } });
    assert.equal(await outbox.hasPendingOutbox(now), false);
    await env.db.outboxEvent.create({ data: { type: "t.d", availableAt: new Date(now.getTime() - MIN) } });
    assert.equal(await outbox.hasPendingOutbox(now), true);
  });

  it("räumt zugestellte Ereignisse nach 14 Tagen und aufgegebene nach 60 Tagen samt Zustellvermerken ab", async () => {
    const now = new Date("2026-08-01T00:00:00Z");
    const DAY = 86_400_000;
    const make = async (data: Record<string, unknown>) => env.db.outboxEvent.create({ data: { type: "t.x", ...data } });
    const oldDone = await make({ processedAt: new Date(now.getTime() - 15 * DAY) });
    await env.db.outboxDelivery.create({ data: { eventId: oldDone.id, handler: "t.h" } });
    const freshDone = await make({ processedAt: new Date(now.getTime() - 13 * DAY) });
    const oldFailed = await make({ failedAt: new Date(now.getTime() - 61 * DAY) });
    const freshFailed = await make({ failedAt: new Date(now.getTime() - 30 * DAY) });
    const pending = await make({});
    const oldParked = await make({ createdAt: new Date(now.getTime() - 15 * DAY) });
    assert.equal(await outbox.pruneOutbox(now), 3, "alt erledigt, alt aufgegeben und seit 14 Tagen offen (Abnehmer-Funktion blieb aus)");
    const left = (await env.db.outboxEvent.findMany()).map((e) => e.id).sort();
    assert.deepEqual(left, [freshDone.id, freshFailed.id, pending.id].sort());
    void oldParked;
    assert.equal(await env.db.outboxDelivery.count(), 0);
    void oldFailed;
  });

  it("der Plattform-Job „platform.outbox“ stellt über die Registry zu (ohne angemeldete Abnehmer: erledigt)", async () => {
    const job = registry.allJobs().find((j) => j.id === "platform.outbox")!;
    const e = await event("invoice.paid");
    const { runner } = rig([job]);
    await runner.sync();
    const [r] = await runner.tick();
    assert.equal(r.status, "ok");
    assert.match(r.message, /1 ohne Abnehmer/);
    assert.ok((await env.db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } })).processedAt);
  });
});

describe("Aufräumen der Ergebnisse", () => {
  it("löscht alte Läufe (30 Tage), kürzt auf die neuesten 200 je Job und entfernt den Zustand nicht mehr bekannter Jobs; laufende bleiben", async () => {
    const now = new Date("2026-08-01T00:00:00Z");
    const DAY = 86_400_000;
    await env.db.jobState.createMany({ data: [{ id: "test.a" }, { id: "test.gone" }] });
    await env.db.jobRun.create({ data: { jobId: "test.a", status: "ok", startedAt: new Date(now.getTime() - 31 * DAY) } });
    await env.db.jobRun.create({ data: { jobId: "test.a", status: "running", startedAt: new Date(now.getTime() - 31 * DAY) } });
    await env.db.jobRun.createMany({ data: Array.from({ length: 210 }, (_, i) => ({ jobId: "test.a", status: "ok", startedAt: new Date(now.getTime() - i * 1000) })) });
    await env.db.jobRun.create({ data: { jobId: "test.gone", status: "ok", startedAt: now } });
    const removed = await maintenance.pruneJobData(["test.a"], now);
    assert.equal(removed, 1 + 10);
    assert.equal(await env.db.jobRun.count({ where: { jobId: "test.a", status: "ok" } }), 200);
    assert.equal(await env.db.jobRun.count({ where: { status: "running" } }), 1);
    assert.equal(await env.db.jobState.count({ where: { id: "test.gone" } }), 0);
    assert.equal(await env.db.jobRun.count({ where: { jobId: "test.gone" } }), 0);
  });

  it("die Statusansicht liefert alle angemeldeten Jobs mit Zustand und die letzten Läufe", async () => {
    const rows = await status.jobStatusRows();
    assert.equal(rows.length, registry.allJobs().length);
    await env.db.jobRun.create({ data: { jobId: "backup.auto", status: "ok", message: "m" } });
    assert.equal((await status.recentJobRuns(5))[0].jobId, "backup.auto");
  });
});

describe("Nur Auffälliges wird festgehalten, Vorabprüfung, Sperre bei Fehlern", () => {
  it("ein Erfolg ohne Meldung hinterlässt keinen Lauf (nur den Zustand); Meldung oder Fehler schon", async () => {
    const quiet = counting();
    const loud = counting("3 gelöscht");
    const { runner, c } = rig([
      { id: "test.quiet", schedule: { every: MIN }, run: quiet },
      { id: "test.loud", schedule: { every: MIN }, run: loud },
    ]);
    await runner.sync();
    await runner.tick();
    c.advance(MIN);
    await runner.tick();
    assert.equal(quiet.calls, 2);
    assert.equal(await env.db.jobRun.count({ where: { jobId: "test.quiet" } }), 0, "keine leeren Läufe");
    assert.equal(await env.db.jobRun.count({ where: { jobId: "test.loud" } }), 2);
    const state = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.quiet" } });
    assert.equal(state.lastStatus, "ok");
    assert.ok(state.lastRunAt, "der Zustand wird trotzdem aktualisiert");
  });

  it("shouldRun: gibt es nichts zu tun, wird nichts geschrieben (keine Sperre, kein Zustand) – „Jetzt ausführen“ umgeht die Vorabprüfung", async () => {
    let work = false;
    const job = counting("erledigt");
    const { runner } = rig([{ id: "test.pre", schedule: { every: MIN }, shouldRun: async () => work, run: job }]);
    await runner.sync();
    const before = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.pre" } });
    assert.deepEqual(await runner.tick(), []);
    assert.equal(job.calls, 0);
    const same = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.pre" } });
    assert.equal(same.updatedAt.getTime(), before.updatedAt.getTime(), "kein Schreibzugriff");
    assert.equal(same.lastRunAt, null);
    work = true;
    assert.equal((await runner.tick()).length, 1);
    work = false;
    assert.equal(job.calls, 1);
    assert.equal((await runner.runNow("test.pre"))?.status, "ok", "von Hand: ohne Vorabprüfung");
    assert.equal(job.calls, 2);
  });

  it("runNow läuft sofort (unabhängig vom Termin) und meldet dem Job manual = true", async () => {
    const seen: boolean[] = [];
    const { runner } = rig([{ id: "test.manual", schedule: { cron: "0 3 * * *" }, run: async ({ manual }) => void seen.push(manual) }]);
    await runner.sync();
    assert.deepEqual(await runner.tick(), [], "nicht fällig");
    assert.equal((await runner.runNow("test.manual"))?.status, "ok");
    assert.deepEqual(seen, [true]);
    assert.equal(await runner.runNow("test.unbekannt"), null);
  });

  it("scheitert das Belegen nach dem Update (Datenbankfehler), wird die Sperre sofort wieder freigegeben – nicht erst nach Ablauf", async () => {
    let failOnce = true;
    const flaky = new Proxy(env.db, {
      get(target, prop, receiver) {
        if (prop === "jobState") {
          return new Proxy(target.jobState, {
            get(inner, name) {
              if (name === "findUniqueOrThrow") {
                return (...args: unknown[]) => {
                  if (failOnce) {
                    failOnce = false;
                    return Promise.reject(new Error("Datenbank kurz weg"));
                  }
                  return (inner.findUniqueOrThrow as (...a: unknown[]) => unknown)(...args);
                };
              }
              const value = Reflect.get(inner, name);
              return typeof value === "function" ? value.bind(inner) : value;
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const job = counting();
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const { runner } = rig([{ id: "test.claim", schedule: { every: MIN }, timeoutMs: 30 * MIN, run: job }], "2026-06-01T10:00:00Z", { db: flaky });
      await runner.sync();
      assert.deepEqual(await runner.tick(), [], "der Takt meldet den Fehler nur im Log");
      const state = await env.db.jobState.findUniqueOrThrow({ where: { id: "test.claim" } });
      assert.equal(state.lockedUntil, null, "Sperre freigegeben");
      assert.equal(runner.isRunning("test.claim"), false);
      assert.equal((await runner.tick()).length, 1, "schon der nächste Takt führt den Job aus");
    } finally {
      console.error = originalError;
    }
    assert.equal(job.calls, 1);
  });

  it("onFailure wird bei Fehlern und bei einer Zeitüberschreitung gerufen (Audit), nicht bei Erfolg", async () => {
    const seen: string[] = [];
    let mode: "ok" | "throw" | "hang" = "throw";
    const hang = new Promise<void>(() => undefined);
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const { runner, c } = rig([
        {
          id: "test.fail",
          schedule: { every: MIN },
          timeoutMs: 10,
          retry: { baseDelayMs: 1000, maxDelayMs: 1000 },
          run: async () => {
            if (mode === "throw") throw new Error("x");
            if (mode === "hang") return hang;
          },
          onFailure: async ({ attempt, timedOut }) => void seen.push(`${attempt}:${timedOut}`),
        },
      ]);
      await runner.sync();
      await runner.tick();
      c.advance(1000);
      mode = "hang";
      await runner.tick();
      c.advance(1000);
      mode = "ok";
      await runner.tick(); // der hängende Lauf ist noch nicht zurück → kein neuer Lauf
      assert.deepEqual(seen, ["1:false", "2:true"]);
    } finally {
      console.error = originalError;
    }
  });
});

describe("Zeitgeber: Start mit Wiederholung, Herzschlag", () => {
  it("scheitert recover() beim Start einmal, läuft der Zeitgeber trotzdem – der nächste Takt holt Vorbereitung und Jobs nach", async () => {
    let failing = true;
    const unstable = new Proxy(env.db, {
      get(target, prop, receiver) {
        if (prop === "jobRun") {
          return new Proxy(target.jobRun, {
            get(inner, name) {
              if (name === "updateMany" && failing) {
                return () => {
                  failing = false;
                  return Promise.reject(new Error("Datenbank beim Start nicht erreichbar"));
                };
              }
              const value = Reflect.get(inner, name);
              return typeof value === "function" ? value.bind(inner) : value;
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const job = counting("lief");
    const originalError = console.error;
    console.error = () => undefined;
    const { runner } = rig([{ id: "test.boot", schedule: { every: MIN }, run: job }], "2026-06-01T10:00:00Z", { db: unstable, startDelayMs: 1, tickMs: 5 });
    try {
      assert.equal(runner.status().started, false);
      runner.start();
      assert.equal(runner.status().started, true);
      await until(() => job.calls > 0, "Job nach fehlgeschlagenem Start ausgeführt");
      assert.equal(runner.status().prepared, true);
      assert.ok(runner.status().lastTickAt, "Herzschlag gesetzt");
      assert.equal(runner.status().lastError, null, "der Fehler ist nach der Wiederholung weg");
    } finally {
      runner.stop();
      console.error = originalError;
    }
    assert.equal(runner.status().started, false);
  });

  it("kein Takt, solange die Vorbereitung scheitert: der Fehler bleibt im Status sichtbar", async () => {
    const dead = new Proxy(env.db, {
      get(target, prop, receiver) {
        if (prop === "jobRun") return { updateMany: () => Promise.reject(new Error("DB aus")) };
        return Reflect.get(target, prop, receiver);
      },
    });
    const job = counting();
    const originalError = console.error;
    console.error = () => undefined;
    const { runner } = rig([{ id: "test.dead", schedule: { every: MIN }, run: job }], "2026-06-01T10:00:00Z", { db: dead as typeof env.db });
    try {
      await assert.rejects(runner.beat());
      assert.equal(job.calls, 0);
      assert.equal(runner.status().prepared, false);
      assert.match(runner.status().lastError ?? "", /Vorbereitung/);
      assert.ok(runner.status().lastTickAt);
    } finally {
      console.error = originalError;
    }
  });

  it("recover() hält Unterbrechungen als Lauf fest (ein Eintrag je belegtem Job) und gibt die Sperren frei", async () => {
    await env.db.jobState.create({ data: { id: "test.a", lockedUntil: new Date(Date.now() + 60_000), lockOwner: "alt" } });
    await env.db.jobState.create({ data: { id: "test.b" } });
    const { runner } = rig([]);
    assert.equal(await runner.recover(), 1);
    const runs = await env.db.jobRun.findMany();
    assert.deepEqual(runs.map((r) => [r.jobId, r.status]), [["test.a", "interrupted"]]);
    assert.equal(await runner.recover(), 0, "idempotent");
    assert.equal(await env.db.jobRun.count(), 1);
  });
});

describe("Automatisches Backup: Reihenfolge und Teilfehler (ZP3-A-12)", () => {
  const settle = async (hour: string, keep: string) => {
    await env.db.appSetting.upsert({ where: { key: "backup.hour" }, update: { value: hour }, create: { key: "backup.hour", value: hour } });
    await env.db.appSetting.upsert({ where: { key: "backup.retention.auto.keep" }, update: { value: keep }, create: { key: "backup.retention.auto.keep", value: keep } });
  };

  it("scheitert nur die Aufbewahrung, bleibt der Lauf ein Erfolg: das Backup ist protokolliert, der Hinweis steht in der Meldung, kein „Backup fehlgeschlagen“", async () => {
    const job = registry.allJobs().find((j) => j.id === "backup.auto")!;
    const core = await import("@/server/backup/core");
    await settle("0", "1");
    await core.createBackup("auto", undefined, new Date(Date.UTC(2026, 4, 1)));
    await core.createBackup("auto", undefined, new Date(Date.UTC(2026, 4, 2)));
    const renameOriginal = fsp.rename;
    mock.method(fsp, "rename", async (from: string, to: string) => {
      if (/schrauberos-.*-auto$/.test(String(from))) throw Object.assign(new Error("gesperrt"), { code: "EBUSY" });
      return renameOriginal(from, to);
    });
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const { runner } = rig([job], "2026-06-01T10:00:00Z", { timeZone: () => "UTC" });
      await runner.sync();
      const [result] = await runner.tick();
      assert.equal(result.status, "ok", "das Backup wurde angelegt");
      assert.match(result.message, /Backup angelegt: schrauberos-.*-auto/);
      assert.match(result.message, /Aufbewahrung fehlgeschlagen/);
      assert.equal(await env.db.auditLog.count({ where: { action: "backup.create" } }), 1, "protokolliert, bevor die Aufbewahrung lief");
      assert.equal(await env.db.auditLog.count({ where: { action: "backup.createFailed" } }), 0);
      assert.equal((await env.db.jobState.findUniqueOrThrow({ where: { id: "backup.auto" } })).failures, 0);
      assert.equal((await core.listBackups()).filter((b) => b.kind === "auto").length, 3, "nichts gelöscht");
    } finally {
      mock.restoreAll();
      console.error = originalError;
      for (const b of await core.listBackups()) await core.deleteBackup(b.name);
    }
  });

  it("„Jetzt ausführen“ legt auch außerhalb der Uhrzeit ein Backup an (der Zeitplan tut es erst zur eingestellten Uhrzeit)", async () => {
    const job = registry.allJobs().find((j) => j.id === "backup.auto")!;
    const core = await import("@/server/backup/core");
    await settle("23", "14"); // Uhrzeit nicht erreicht
    try {
      const { runner } = rig([job], new Date().toISOString(), { timeZone: () => "UTC" });
      await runner.sync();
      await env.db.jobState.update({ where: { id: "backup.auto" }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      const [idle] = await runner.tick();
      assert.equal(idle.message, "", "Uhrzeit nicht erreicht: nichts zu tun");
      assert.equal((await core.listBackups()).length, 0);
      const forced = await runner.runNow("backup.auto");
      assert.equal(forced?.status, "ok");
      assert.match(forced?.message ?? "", /Backup angelegt/);
      assert.equal((await core.listBackups()).length, 1);
    } finally {
      for (const b of await core.listBackups()) await core.deleteBackup(b.name);
    }
  });

  it("eine Zeitüberschreitung des Backups wird wie ein Fehlschlag protokolliert (onFailure → Audit, nur der erste der Serie)", async () => {
    const job = registry.allJobs().find((j) => j.id === "backup.auto")!;
    const hung: JobDef = { ...job, timeoutMs: 10, run: () => new Promise<void>(() => undefined) };
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const { runner } = rig([hung], "2026-06-01T10:00:00Z");
      await runner.sync();
      const [result] = await runner.tick();
      assert.deepEqual([result.status, result.message], ["error", "Zeitüberschreitung"]);
      assert.equal(await env.db.auditLog.count({ where: { action: "backup.createFailed" } }), 1);
    } finally {
      console.error = originalError;
    }
  });
});

describe("Zeitzone: Backup-Uhrzeit und Neuberechnung", () => {
  it("runAutoBackup rechnet in der Werkstatt-Zone (nicht in TZ): nach einem Wechsel der Zone gilt die neue Ortszeit", async () => {
    const { runAutoBackup } = await import("@/server/backup/auto");
    const core = await import("@/server/backup/core");
    const { withWorkshopZone } = await import("@/test/zone");
    const { setWorkshopZone } = await import("@/lib/zone");
    await env.db.appSetting.upsert({ where: { key: "backup.hour" }, update: { value: "21" }, create: { key: "backup.hour", value: "21" } });
    const at = new Date("2026-06-01T10:00:00Z"); // UTC 10:00, Auckland 22:00
    // der Prozess läuft in Berlin (12:00): weder UTC noch Auckland – nur die Werkstatt-Zone entscheidet
    await withWorkshopZone("UTC", async () => {
      assert.equal(await runAutoBackup(at), null, "10 Uhr UTC: die Uhrzeit 21 ist noch nicht erreicht");
      setWorkshopZone("Pacific/Auckland");
      try {
        const result = await runAutoBackup(at);
        assert.ok(result?.name, "22 Uhr in Auckland: die Uhrzeit ist erreicht");
        // „heute schon eins“ gilt je Kalendertag der Ortszeit (das Backup trägt die echte Uhrzeit, deshalb mit der echten Uhr prüfen)
        await env.db.appSetting.update({ where: { key: "backup.hour" }, data: { value: "0" } });
        assert.equal(await runAutoBackup(new Date()), null, "heute (Ortszeit) ist schon eins da");
      } finally {
        for (const b of await core.listBackups()) await core.deleteBackup(b.name);
      }
    }, "Europe/Berlin");
  });

  it("reschedule: rechnet Cron-Termine in der neuen Zone neu (auch über die Sommerzeit-Lücke), lässt Intervalle, Fehlerserien und laufende Jobs unberührt", async () => {
    const zone = { current: "Europe/Berlin" };
    const { runner, c } = rig(
      [
        { id: "test.cron", schedule: { cron: "30 2 * * *" }, run: counting() },
        { id: "test.failing", schedule: { cron: "30 2 * * *" }, run: counting() },
        { id: "test.every", schedule: { every: 10 * MIN }, run: counting() },
      ],
      "2026-03-28T12:00:00Z",
      { timeZone: () => zone.current },
    );
    await runner.sync();
    const nextOf = async (id: string) => (await env.db.jobState.findUniqueOrThrow({ where: { id } })).nextRunAt!.toISOString();
    assert.equal(await nextOf("test.cron"), "2026-03-29T01:30:00.000Z", "29.3. in Berlin: 02:30 gibt es nicht – unmittelbar nach der Lücke (03:30 Sommerzeit)");
    await env.db.jobState.update({ where: { id: "test.failing" }, data: { failures: 2, nextRunAt: new Date(c.now().getTime() + 90 * MIN) } });
    const everyBefore = await nextOf("test.every");
    zone.current = "America/New_York";
    await runner.reschedule();
    assert.equal(await nextOf("test.cron"), "2026-03-29T06:30:00.000Z", "02:30 New York (Sommerzeit seit 8.3.) = 06:30 UTC");
    assert.equal(await nextOf("test.failing"), new Date(c.now().getTime() + 90 * MIN).toISOString(), "Fehlerserie: Wiederholungstermin bleibt");
    assert.equal(await nextOf("test.every"), everyBefore, "Intervalle sind zeitzonenunabhängig");
  });
});
