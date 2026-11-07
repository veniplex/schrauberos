import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FairLane, QueueFullError, Semaphore } from "./semaphore";

/** Eine Aufgabe, die erst endet, wenn man sie freigibt – und festhält, in welcher Reihenfolge sie begann. */
function gate(log: string[], name: string) {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  return { release, run: () => (log.push(name), done) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("FairLane (Eigentümer-Pfad, R2-SEC-01)", () => {
  it("lässt höchstens `limit` Aufgaben gleichzeitig laufen, die übrigen warten", async () => {
    const lane = new FairLane(1, 8, 2);
    const log: string[] = [];
    const a = gate(log, "a:1");
    const b = gate(log, "b:1");
    const first = lane.run("a", a.run);
    const second = lane.run("b", b.run);
    await tick();
    assert.deepEqual(log, ["a:1"]);
    assert.equal(lane.active, 1);
    assert.equal(lane.waiting, 1);
    a.release();
    await first;
    await tick();
    assert.deepEqual(log, ["a:1", "b:1"]);
    b.release();
    await second;
    assert.equal(lane.active + lane.waiting, 0);
  });

  it("je Schlüssel höchstens `perKey` Aufgaben (laufende und wartende): die dritte desselben Schlüssels wird abgewiesen, ein anderer Schlüssel nicht", async () => {
    const lane = new FairLane(1, 8, 2);
    const log: string[] = [];
    const g = [gate(log, "x1"), gate(log, "x2"), gate(log, "y1")];
    const x1 = lane.run("x", g[0].run);
    const x2 = lane.run("x", g[1].run);
    await assert.rejects(lane.run("x", async () => "nie"), QueueFullError);
    const y1 = lane.run("y", g[2].run);
    await tick();
    assert.equal(lane.waiting, 2);
    g.forEach((x) => x.release());
    await Promise.all([x1, x2, y1]);
    // nach dem Aufräumen ist der Platz wieder frei
    assert.equal(await lane.run("x", async () => "frei"), "frei");
  });

  it("begrenzt die Warteschlange insgesamt (QueueFullError), ohne laufende Aufgaben zu stören", async () => {
    const lane = new FairLane(1, 3, 2);
    const log: string[] = [];
    const gates = Array.from({ length: 4 }, (_, i) => gate(log, `k${i}`));
    const runs = gates.map((g, i) => lane.run(`k${i}`, g.run)); // 1 läuft, 3 warten
    await tick();
    assert.equal(lane.waiting, 3);
    await assert.rejects(lane.run("k9", async () => "zu viel"), QueueFullError);
    for (const g of gates) g.release();
    await Promise.all(runs);
  });

  it("arbeitet reihum über die Schlüssel ab: ein Schlüssel mit vielen Wartenden verdrängt keinen anderen", async () => {
    const lane = new FairLane(1, 16, 4);
    const log: string[] = [];
    const gates = new Map<string, ReturnType<typeof gate>>();
    const start = (key: string, n: number) => {
      const g = gate(log, `${key}${n}`);
      gates.set(`${key}${n}`, g);
      return lane.run(key, g.run);
    };
    // a belegt den Platz, dann stellen sich a2, a3, a4 an – und danach b1, c1
    const runs = [start("a", 1), start("a", 2), start("a", 3), start("a", 4), start("b", 1), start("c", 1)];
    await tick();
    const finished: string[] = [];
    // der Reihe nach beenden, was gerade läuft
    for (let i = 0; i < 6; i++) {
      const running = log[log.length - 1];
      finished.push(running);
      gates.get(running)!.release();
      await tick();
    }
    await Promise.all(runs);
    // a1 lief zuerst; danach kommen b1 und c1 vor a3 und a4 dran (reihum), nicht in Ankunftsreihenfolge
    assert.deepEqual(finished.slice(0, 3), ["a1", "a2", "b1"]);
    assert.ok(finished.indexOf("b1") < finished.indexOf("a3") && finished.indexOf("c1") < finished.indexOf("a4"), finished.join(" "));
  });

  it("gibt den Platz auch bei einem Fehler der Aufgabe frei", async () => {
    const lane = new FairLane(1, 2, 1);
    await assert.rejects(
      lane.run("a", async () => {
        throw new Error("kaputt");
      }),
      /kaputt/,
    );
    assert.equal(await lane.run("a", async () => 7), 7);
    assert.equal(lane.active, 0);
  });
});

describe("Semaphore (Anmeldungen)", () => {
  it("weist bei voller Warteschlange ab, wenn `bounded`, wartet sonst", async () => {
    const sem = new Semaphore(1, 1);
    const log: string[] = [];
    const a = gate(log, "a");
    const b = gate(log, "b");
    const r1 = sem.run(a.run);
    const r2 = sem.run(b.run, { bounded: true });
    await assert.rejects(sem.run(async () => 0, { bounded: true }), QueueFullError);
    a.release();
    b.release();
    await Promise.all([r1, r2]);
  });
});
