import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Die Pfade für scrypt (`hashSemaphore`, `ownerLane`) sind **Prozess-Singletons**: Der gebaute Server enthält `password.ts` in mehreren Bündeln, und jede Kopie hätte sonst eigene Grenzen (bei 128 MiB je
 * Tresor-Ableitung ein Speicher- und Thread-Verstärker). Zwei Ladevorgänge desselben Moduls (anderer Cache-Schlüssel) müssen darum dieselben Instanzen liefern.
 */
let env: TestEnv;
before(async () => {
  env = await createTestEnv();
});
after(() => env.cleanup());

describe("scrypt-Pfade: ein Satz je Prozess", () => {
  it("zwei Kopien des Moduls teilen sich Anmelde-Semaphore und Eigentümer-Pfad", async () => {
    const first = await import("./password");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second: typeof first = await import(/* @vite-ignore */ `./password?kopie=${Date.now()}` as any);
    assert.notEqual(second, first, "tatsächlich eine zweite Modulkopie");
    assert.equal(second.ownerLane, first.ownerLane);
    assert.equal(second.hashSemaphore, first.hashSemaphore);
  });
});
