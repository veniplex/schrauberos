import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activateUpdate, canRegister, clearOfflineCaches, registerServiceWorker, swUrl, type RegistrationLike, type ServiceWorkerContainerLike, type ServiceWorkerLike } from "./sw-client";

/** Browser-Seite des Service Workers (P3-5): Registrierung nur im Betrieb und im sicheren Kontext, Hinweis auf neue Version, Abmelden leert die Zwischenspeicher. */
class FakeWorker implements ServiceWorkerLike {
  state = "installing";
  messages: unknown[] = [];
  listeners: Array<() => void> = [];
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  addEventListener(_type: "statechange", listener: () => void) {
    this.listeners.push(listener);
  }
  become(state: string) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

const recorder = () => ({
  messages: [] as unknown[],
  postMessage(message: unknown) {
    this.messages.push(message);
  },
});

function fakeContainer(options: { controller?: boolean; waiting?: FakeWorker | null } = {}) {
  const active = recorder();
  const controller = recorder();
  const registration = {
    waiting: options.waiting ?? null,
    installing: null as FakeWorker | null,
    updateFound: [] as Array<() => void>,
    addEventListener(_type: "updatefound", listener: () => void) {
      this.updateFound.push(listener);
    },
  };
  const changes: Array<() => void> = [];
  const registered: Array<{ url: string; options: unknown }> = [];
  const container = {
    controller: options.controller === false ? null : controller,
    register: async (url: string, opts?: unknown): Promise<RegistrationLike> => {
      registered.push({ url, options: opts });
      return registration as unknown as RegistrationLike;
    },
    ready: Promise.resolve({ active }),
    addEventListener: (_type: "controllerchange", listener: () => void) => void changes.push(listener),
  } satisfies ServiceWorkerContainerLike;
  return { container, registration, active, controller, changes, registered };
}

const env = (container: ServiceWorkerContainerLike | undefined, overrides: Partial<{ production: boolean; isSecureContext: boolean }> = {}) => ({ production: true, isSecureContext: true, container, ...overrides });

describe("Service Worker (Seite): Registrierung", () => {
  it("die Adresse trägt die Version (maskiert)", () => {
    assert.equal(swUrl("1.2.3+abc"), "/sw.js?v=1.2.3%2Babc");
  });

  it("nur im Betrieb, nur im sicheren Kontext (HTTPS/localhost), nur mit Browser-Unterstützung", async () => {
    const { container } = fakeContainer();
    assert.equal(canRegister(env(container)), true);
    assert.equal(canRegister(env(container, { production: false })), false, "Entwicklung: nie (Dateinamen nicht gehasht)");
    assert.equal(canRegister(env(container, { isSecureContext: false })), false, "HTTP im LAN: kein Service Worker möglich");
    assert.equal(canRegister(env(undefined)), false);
    for (const overrides of [{ production: false }, { isSecureContext: false }]) {
      const fake = fakeContainer();
      assert.equal(await registerServiceWorker({ version: "1", env: env(fake.container, overrides), onUpdate: () => assert.fail("kein Hinweis") }), false);
      assert.equal(fake.registered.length, 0);
    }
    assert.equal(await registerServiceWorker({ version: "1", env: env(undefined), onUpdate: () => assert.fail("kein Hinweis") }), false);
  });

  it("registriert mit Version, Wurzel-Geltungsbereich und ohne Zwischenspeicher des Skripts; sichert danach die Offline-Seite", async () => {
    const fake = fakeContainer();
    assert.equal(await registerServiceWorker({ version: "1.0.0", env: env(fake.container), onUpdate: () => {} }), true);
    assert.deepEqual(fake.registered, [{ url: "/sw.js?v=1.0.0", options: { scope: "/", updateViaCache: "none" } }]);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(fake.active.messages, [{ type: "WARM" }]);
  });

  it("ein Fehler beim Registrieren bleibt still (die Anwendung läuft ohne Service Worker weiter)", async () => {
    const fake = fakeContainer();
    fake.container.register = async () => {
      throw new Error("SecurityError");
    };
    assert.equal(await registerServiceWorker({ version: "1", env: env(fake.container), onUpdate: () => assert.fail("kein Hinweis") }), false);
  });
});

describe("Service Worker (Seite): neue Version", () => {
  it("ein bereits wartender Service Worker (Seite wird schon von einem gesteuert) löst den Hinweis aus", async () => {
    const waiting = new FakeWorker();
    const fake = fakeContainer({ waiting });
    const seen: ServiceWorkerLike[] = [];
    await registerServiceWorker({ version: "2", env: env(fake.container), onUpdate: (w) => seen.push(w) });
    assert.deepEqual(seen, [waiting]);
  });

  it("ein neu installierter (updatefound, dann installed) löst ihn aus – ein halb installierter nicht", async () => {
    const fake = fakeContainer();
    const seen: ServiceWorkerLike[] = [];
    await registerServiceWorker({ version: "2", env: env(fake.container), onUpdate: (w) => seen.push(w) });
    const worker = new FakeWorker();
    fake.registration.installing = worker;
    for (const listener of fake.registration.updateFound) listener();
    worker.become("installing");
    assert.equal(seen.length, 0);
    worker.become("installed");
    assert.deepEqual(seen, [worker]);
  });

  it("die allererste Installation (noch kein steuernder Service Worker) meldet nichts", async () => {
    const waiting = new FakeWorker();
    const fake = fakeContainer({ controller: false, waiting });
    await registerServiceWorker({ version: "1", env: env(fake.container), onUpdate: () => assert.fail("kein Hinweis beim ersten Mal") });
    const worker = new FakeWorker();
    fake.registration.installing = worker;
    for (const listener of fake.registration.updateFound) listener();
    worker.become("installed");
  });

  it("Neu laden: SKIP_WAITING an den wartenden, Neuladen genau einmal, sobald er übernimmt", () => {
    const worker = new FakeWorker();
    const fake = fakeContainer();
    let reloads = 0;
    activateUpdate(worker, fake.container, () => reloads++);
    assert.deepEqual(worker.messages, [{ type: "SKIP_WAITING" }]);
    assert.equal(reloads, 0, "erst wenn der neue Service Worker die Seite übernommen hat");
    for (const listener of fake.changes) listener();
    for (const listener of fake.changes) listener();
    assert.equal(reloads, 1);
  });
});

describe("Service Worker (Seite): Abmelden leert die Zwischenspeicher", () => {
  const fakeCaches = (names: string[]) => {
    const store = new Set(names);
    return { store, keys: async () => [...store], delete: async (name: string) => store.delete(name) };
  };

  it("schickt CLEAR an den steuernden Service Worker und löscht zusätzlich selbst die eigenen Zwischenspeicher (fremde bleiben)", async () => {
    const fake = fakeContainer();
    const caches = fakeCaches(["sos-static-1", "sos-offline-1", "sos-static-0", "fremd"]);
    await clearOfflineCaches({ container: fake.container, caches });
    assert.deepEqual(fake.controller.messages, [{ type: "CLEAR" }]);
    assert.deepEqual([...caches.store], ["fremd"]);
  });

  it("ohne steuernden Service Worker und ohne Cache-Schnittstelle: kein Fehler", async () => {
    const fake = fakeContainer({ controller: false });
    await clearOfflineCaches({ container: fake.container, caches: undefined });
    await clearOfflineCaches({ container: undefined, caches: undefined });
    assert.deepEqual(fake.controller.messages, []);
  });

  it("scheitert das Löschen, wird das Abmelden nicht aufgehalten", async () => {
    const broken = {
      keys: async (): Promise<string[]> => {
        throw new Error("x");
      },
      delete: async () => false,
    };
    await clearOfflineCaches({ container: undefined, caches: broken });
  });
});
