import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FailureBudget, Gate, RateWindow } from "./login-throttle";
import { Semaphore, QueueFullError } from "./semaphore";
import { clientIp } from "./client-ip";
import { MAX_PASSWORD_BYTES, passwordProblem } from "./password-rules";

let clock = 1_000_000;
const now = () => clock;
const gate = (over: Partial<ConstructorParameters<typeof Gate>[0]> = {}) => new Gate({ free: 3, baseMs: 2_000, capMs: 90_000, decayMs: 15 * 60_000, maxEntries: 100, now, ...over });

describe("Gate (Drosselung je Konto)", () => {
  it("lässt die freien Versuche ohne Wartezeit durch und verdoppelt danach bis zur Obergrenze", () => {
    clock = 1_000_000;
    const g = gate();
    const delays = Array.from({ length: 12 }, () => {
      assert.equal(g.check("anna"), 0);
      const { delayMs } = g.take("anna");
      clock += delayMs; // der Nächste wartet genau die Wartezeit ab
      return delayMs;
    });
    assert.deepEqual(delays, [0, 0, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 90_000, 90_000, 90_000, 90_000]);
    assert.ok(Math.max(...delays) <= 120_000, "Obergrenze 60–120 s");
  });

  it("weist während der Wartezeit ab, ohne sie zu verlängern", () => {
    clock = 1_000_000;
    const g = gate();
    for (let i = 0; i < 3; i++) g.take("anna");
    const first = g.check("anna");
    assert.equal(first, 2_000);
    for (let i = 0; i < 1000; i++) assert.ok(g.check("anna") > 0); // Dauerbeschuss: prüfen, aber nie belegen
    clock += 1_999;
    assert.equal(g.check("anna"), 1);
    clock += 1;
    assert.equal(g.check("anna"), 0);
  });

  it("ein Schwung von Versuchen, die synchron prüfen und belegen, kommt nur bis zu den freien Versuchen durch", () => {
    clock = 1_000_000;
    const g = gate();
    let passed = 0;
    for (let i = 0; i < 500; i++) {
      if (g.check("anna") !== 0) continue;
      g.take("anna");
      passed++;
    }
    assert.equal(passed, 3);
  });

  it("Erfolg setzt zurück; nach langer Ruhe beginnt die Zählung von vorn", () => {
    clock = 1_000_000;
    const g = gate();
    for (let i = 0; i < 3; i++) g.take("anna");
    g.succeed("anna");
    assert.equal(g.check("anna"), 0);
    assert.equal(g.attemptsOf("anna"), 0);
    for (let i = 0; i < 3; i++) g.take("bert");
    clock += 15 * 60_000 + 1;
    assert.equal(g.check("bert"), 0);
    assert.equal(g.take("bert").attempts, 1);
  });

  it("verzeiht einzelne Versuche (Überlast, gemeinsame Adresse)", () => {
    clock = 1_000_000;
    const g = gate();
    for (let i = 0; i < 3; i++) g.take("anna");
    g.forgive("anna", 1);
    assert.equal(g.check("anna"), 0);
  });

  it("begrenzt den Speicher: Zehntausende Namen füllen ihn nicht über die Obergrenze", () => {
    clock = 1_000_000;
    const g = gate({ maxEntries: 200 });
    for (let i = 0; i < 20_000; i++) g.take(`name-${i}`);
    assert.ok(g.size <= 200, `Größe ${g.size}`);
    // der zuletzt benutzte Eintrag überlebt
    assert.equal(g.attemptsOf("name-19999"), 1);
  });

  it("verdrängt bei Überlauf nie einen Eintrag mit laufender Wartezeit: eine Flut erfundener Namen entsperrt kein Konto", () => {
    clock = 1_000_000;
    const g = gate({ maxEntries: 200 });
    for (let i = 0; i < 4; i++) g.take("admin"); // Wartezeit läuft
    const wait = g.check("admin");
    assert.ok(wait > 0);
    for (let i = 0; i < 20_000; i++) g.take(`flut-${i}`); // nur freie Versuche, keine Wartezeit
    assert.equal(g.check("admin"), wait, "die Wartezeit des Kontos besteht weiter");
    assert.ok(g.size <= 200);
  });

  it("auch eine Flut von Namen MIT Wartezeit sprengt die Grenze nicht: höchstens das Doppelte, zuerst fällt, was am frühesten abläuft", () => {
    clock = 1_000_000;
    const g = gate({ maxEntries: 100 });
    for (let i = 0; i < 4; i++) g.take("admin"); // 2 s Wartezeit
    for (let i = 0; i < 6; i++) g.take("admin"); // weiter hochgezählt: lange Wartezeit
    const wait = g.check("admin");
    assert.ok(wait >= 16_000, `Wartezeit ${wait}`);
    for (let i = 0; i < 2_000; i++) {
      const key = `flut-${i}`;
      for (let n = 0; n < 4; n++) g.take(key); // jeder Name bekommt 2 s Wartezeit
      assert.ok(g.size <= 200, `Größe ${g.size}`);
    }
    assert.equal(g.check("admin"), wait, "der Eintrag mit der längsten Restzeit wird zuletzt verdrängt");
  });

  it("unbekannte und bekannte Namen verhalten sich gleich (der Speicher kennt nur Schlüssel)", () => {
    clock = 1_000_000;
    const g = gate();
    const run = (key: string) => [g.take(key).delayMs, g.take(key).delayMs, g.take(key).delayMs, g.check(key)];
    assert.deepEqual(run("anna"), run("ghost-user"));
  });
});

describe("FailureBudget (globales Fehlversuchs-Budget)", () => {
  it("verlangsamt oberhalb des Budgets, höchstens bis zur Obergrenze – und weist nie ab", () => {
    clock = 1_000_000;
    const b = new FailureBudget({ limit: 30, windowMs: 60_000, stepMs: 50, maxDelayMs: 3_000, maxStamps: 5_000, now });
    for (let i = 0; i < 30; i++) b.record();
    assert.equal(b.delayMs(), 0);
    for (let i = 0; i < 20; i++) b.record();
    assert.equal(b.delayMs(), 1_000);
    for (let i = 0; i < 10_000; i++) b.record();
    assert.equal(b.delayMs(), 3_000);
    clock += 61_000;
    assert.equal(b.delayMs(), 0, "nach einer Minute Ruhe wieder normal");
  });
});

describe("RateWindow (Audit-Drosselung)", () => {
  it("lässt je Schlüssel nur einen Eintrag pro Zeitraum und insgesamt höchstens das globale Limit zu", () => {
    clock = 1_000_000;
    const w = new RateWindow({ perKeyMs: 60_000, globalLimit: 5, globalWindowMs: 60_000, maxKeys: 100, now });
    assert.equal(w.allow("a"), true);
    assert.equal(w.allow("a"), false);
    assert.deepEqual(["b", "c", "d", "e", "f", "g"].map((k) => w.allow(k)), [true, true, true, true, false, false]);
    clock += 60_001;
    assert.equal(w.allow("a"), true);
  });
});

describe("Semaphore", () => {
  it("lässt höchstens `limit` Aufgaben gleichzeitig laufen und weist bei voller Warteschlange ab", async () => {
    const s = new Semaphore(2, 3);
    let running = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const task = () =>
      s.run(
        () =>
          new Promise<void>((resolve) => {
            running++;
            peak = Math.max(peak, running);
            release.push(() => {
              running--;
              resolve();
            });
          }),
        { bounded: true },
      );
    const pending = Array.from({ length: 8 }, () => task().then(() => "ok", (e) => (e instanceof QueueFullError ? "full" : "error")));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(peak, 2);
    assert.equal(s.waiting, 3);
    // die drei überzähligen wurden sofort abgewiesen
    while (release.length) {
      release.shift()!();
      await new Promise((r) => setTimeout(r, 1));
    }
    const done = await Promise.all(pending);
    assert.equal(done.filter((r) => r === "full").length, 3);
    assert.equal(done.filter((r) => r === "ok").length, 5);
    assert.ok(peak <= 2);
  });

  it("unbegrenzte Aufgaben warten immer", async () => {
    const s = new Semaphore(1, 0);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => s.run(async () => void order.push(n))));
    assert.deepEqual(order, [1, 2, 3]);
  });
});

describe("clientIp", () => {
  it("ohne Reverse-Proxy-Einstellung wird der Header ignoriert", () => {
    assert.equal(clientIp("1.2.3.4", false), null);
    assert.equal(clientIp("1.2.3.4, 5.6.7.8", false), null);
  });

  it("mit Reverse-Proxy zählt der letzte Eintrag – gefälschte Einträge davor ändern nichts", () => {
    assert.equal(clientIp("1.1.1.1, 2.2.2.2, 3.3.3.3", true), "3.3.3.3");
    assert.equal(clientIp("9.9.9.9, 3.3.3.3", true), clientIp("8.8.8.8, 3.3.3.3", true));
    assert.equal(clientIp("3.3.3.3", true), "3.3.3.3");
  });

  it("vereinheitlicht Ports und IPv4-in-IPv6; Unbrauchbares ergibt null", () => {
    assert.equal(clientIp("3.3.3.3:5555", true), "3.3.3.3");
    assert.equal(clientIp("::ffff:3.3.3.3", true), "3.3.3.3");
    assert.equal(clientIp("[2001:db8::1]:443", true), "2001:db8::1");
    assert.equal(clientIp("not-an-ip", true), null);
    assert.equal(clientIp("1.2.3.4, unknown", true), null);
    assert.equal(clientIp(null, true), null);
    assert.equal(clientIp("", true), null);
  });
});

describe("Passwortregeln", () => {
  it("Mindestlänge in Zeichen, Obergrenze in Zeichen und Bytes", () => {
    assert.equal(passwordProblem("kurz"), "short");
    assert.equal(passwordProblem("lang-genug-1"), null);
    assert.equal(passwordProblem("a".repeat(128)), null);
    assert.equal(passwordProblem("a".repeat(129)), "long");
    assert.equal(passwordProblem("😀".repeat(128)), null, "128 Zeichen zu je 4 Bytes sind erlaubt");
    assert.equal(passwordProblem("😀".repeat(129)), "long");
    assert.ok(new TextEncoder().encode("😀".repeat(128)).length <= MAX_PASSWORD_BYTES);
    assert.equal(passwordProblem("x".repeat(100_000)), "long");
  });
});

describe("Grenzwerte der Drosselung (Z6-4 L-1: jeweils genau auf, direkt davor und direkt dahinter)", () => {
  it("Zerfall: genau nach der Ruhezeit zählt der Versuch noch weiter, eine Millisekunde später beginnt die Zählung von vorn", () => {
    clock = 1_000_000;
    const g = gate();
    for (let i = 0; i < 4; i++) g.take("anna");
    clock += 15 * 60_000;
    assert.equal(g.take("anna").attempts, 5, "genau decayMs: kein Zerfall");
    clock += 15 * 60_000 + 1;
    assert.equal(g.take("anna").attempts, 1, "decayMs + 1 ms: von vorn");
  });

  it("verzeihen: genau n Versuche weniger, nie unter null; nur unter den freien Versuchen entfällt die Wartezeit", () => {
    clock = 1_000_000;
    const g = gate();
    for (let i = 0; i < 4; i++) g.take("anna"); // 4 Versuche, Wartezeit nach dem vierten
    assert.ok(g.check("anna") > 0);
    g.forgive("anna", 1);
    assert.equal(g.attemptsOf("anna"), 3, "genau einer weniger");
    assert.ok(g.check("anna") > 0, "mit 3 von 3 freien ist die Wartezeit noch da");
    g.forgive("anna", 1);
    assert.equal(g.attemptsOf("anna"), 2);
    assert.equal(g.check("anna"), 0, "unter den freien Versuchen entfällt die Wartezeit");
    assert.equal(g.take("anna").delayMs, 2_000, "der dritte Versuch löst die erste Wartezeit aus (2 s), nicht eine längere");
    g.forgive("anna", 50);
    assert.equal(g.attemptsOf("anna"), 0, "nie unter null");
    assert.equal(g.take("anna").attempts, 1);
  });

  it("globales Budget: das 30. Ereignis kostet noch nichts, das 31. genau einen Schritt, die Obergrenze gilt ab dem Schritt davor nicht und danach", () => {
    clock = 1_000_000;
    const b = new FailureBudget({ limit: 30, windowMs: 60_000, stepMs: 50, maxDelayMs: 3_000, maxStamps: 5_000, now });
    for (let i = 0; i < 30; i++) b.record();
    assert.equal(b.delayMs(), 0, "genau auf dem Budget");
    b.record();
    assert.equal(b.delayMs(), 50, "ein Ereignis darüber: genau ein Schritt");
    for (let i = 0; i < 58; i++) b.record(); // 89 → 59 über dem Budget
    assert.equal(b.delayMs(), 2_950);
    b.record();
    assert.equal(b.delayMs(), 3_000, "60 über dem Budget: genau die Obergrenze");
    b.record();
    assert.equal(b.delayMs(), 3_000, "darüber bleibt es dabei");
    // ein Ereignis, das genau windowMs alt ist, zählt noch; eine Millisekunde älter nicht mehr
    clock += 60_000;
    assert.ok(b.delayMs() > 0);
    clock += 1;
    assert.equal(b.delayMs(), 0);
  });

  it("Passwortlänge: 7/8 und 128/129 Zeichen", () => {
    assert.equal(passwordProblem("a".repeat(7)), "short");
    assert.equal(passwordProblem("a".repeat(8)), null);
    assert.equal(passwordProblem("a".repeat(128)), null);
    assert.equal(passwordProblem("a".repeat(129)), "long");
  });
});
