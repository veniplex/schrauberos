import assert from "node:assert/strict";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { after, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Last: 200 gleichzeitige Anmeldungen – die Anwendung antwortet weiter, es wird nie mehr als erlaubt gerechnet. */
let env: TestEnv;
let session: typeof import("./session");
let passwordMod: typeof import("./password");

before(async () => {
  env = await createTestEnv();
  session = await import("./session");
  passwordMod = await import("./password");
  const runtime = await import("./runtime");
  runtime.authRuntime.sleep = async () => undefined; // Wartezeiten nicht wirklich abwarten
});
after(() => env.cleanup());

describe("Überlast durch gleichzeitige Anmeldungen", () => {
  it("200 parallele Logins mit erfundenen Namen: kein Hash, kein belegter Platz, die Anwendung antwortet weiter", async () => {
    const user = await env.user({ username: "chef", password: "chef-passwort-1" });
    await env.signIn(user);
    passwordMod.hashStats.computed = 0;

    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const started = performance.now();
    const flood = Array.from({ length: 200 }, (_, i) => session.login(`flut-${i}`, "falsches-passwort-123"));
    // Währenddessen: eine ganz normale Anfrage (Sitzung auflösen), eine Datenbankabfrage und die echte Anmeldung des Administrators
    const probeStarted = performance.now();
    const probe = Promise.all([session.getSession(), env.db.user.count()]).then(() => performance.now() - probeStarted);
    const real = session.login("chef", "chef-passwort-1");
    const results = await Promise.all(flood);
    const probeMs = await probe;
    delay.disable();
    console.log(`  200 erfundene Namen in ${(performance.now() - started).toFixed(0)} ms, gerechnet: ${passwordMod.hashStats.computed}, größte Ereignisschleifen-Pause: ${(delay.max / 1e6).toFixed(0)} ms, Sitzungsabfrage: ${probeMs.toFixed(0)} ms`);

    assert.ok(results.every((r) => !r.ok && r.reason === "invalid"), "jede Anmeldung bekommt dieselbe Antwort, keine wird abgewiesen");
    assert.equal((await real).ok, true, "der echte Administrator kommt gleichzeitig durch");
    assert.equal(passwordMod.hashStats.computed, 1, "nur die echte Anmeldung wurde gerechnet");
    assert.equal(passwordMod.hashSemaphore.active + passwordMod.hashSemaphore.waiting, 0);
    assert.ok(delay.max / 1e6 < 500, `die Ereignisschleife stand ${(delay.max / 1e6).toFixed(0)} ms still`);
    assert.ok(probeMs < 3000, `Sitzungsabfrage dauerte ${probeMs} ms`);
  });

  it("viele verschiedene echte Konten gleichzeitig: höchstens 2 Hashes gleichzeitig, die Warteschlange ist begrenzt (busy statt unbegrenztem Warten)", async () => {
    const passwordHash = await passwordMod.hashPassword("irgendein-passwort-1", "test");
    await env.db.user.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ username: `konto-${i}`, name: `Konto ${i}`, passwordHash })) });
    passwordMod.hashStats.computed = 0;

    let concurrent = 0;
    let peak = 0;
    const original = passwordMod.hashSemaphore.run.bind(passwordMod.hashSemaphore);
    passwordMod.hashSemaphore.run = (async (task: () => Promise<unknown>, options?: { bounded?: boolean }) =>
      original(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        try {
          return await task();
        } finally {
          concurrent--;
        }
      }, options)) as typeof passwordMod.hashSemaphore.run;

    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => session.login(`konto-${i}`, "falsches-passwort-123")));
    const kinds = results.map((r) => (r.ok ? "ok" : r.reason));
    const busy = kinds.filter((k) => k === "busy").length;
    console.log(`  60 echte Konten: gerechnet ${passwordMod.hashStats.computed}, abgewiesen (busy): ${busy}, Spitzenlast gleichzeitig: ${peak}`);
    assert.equal(busy + kinds.filter((k) => k === "invalid").length, 60, "jede Anmeldung bekommt eine Antwort");
    assert.ok(busy > 0, "bei Überlast wird abgewiesen statt unbegrenzt zu warten");
    assert.ok(peak <= 2, `höchstens 2 gleichzeitige Hashes, war ${peak}`);
    assert.ok(passwordMod.hashStats.computed <= 40, `gerechnet: ${passwordMod.hashStats.computed}`);
  });

  it("abgewiesene (busy) Anmeldungen zählen nicht als Fehlversuch des Kontos", async () => {
    const { loginThrottle } = await import("./throttle");
    const busy = (await Promise.all(Array.from({ length: 60 }, (_, i) => session.login(`konto-${i}`, "falsches-passwort-123")))).findIndex((r) => !r.ok && r.reason === "busy");
    assert.ok(busy >= 0);
    assert.ok(loginThrottle.accounts.attemptsOf(`konto-${busy}`) <= 1);
    // wer nach der Überlast mit dem richtigen Passwort kommt, wird nicht ausgebremst
    const result = await session.login("chef", "chef-passwort-1");
    assert.equal(result.ok, true);
  });
});
