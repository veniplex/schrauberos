import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Ablauf eines Tokens (Z6-4 L-1): genau zur Ablaufzeit ist es abgelaufen (`<= jetzt`), eine Millisekunde davor gilt es noch. */
let env: TestEnv;
let router: typeof import("./router");
let state: typeof import("./state");
const fixed = Date.parse("2030-06-01T12:00:00.000Z");
let realNow: () => number;

before(async () => {
  env = await createTestEnv();
  router = await import("./router");
  state = await import("./state");
  state.apiLimits.failuresGlobal = 1_000_000;
  realNow = state.apiRuntime.now;
});
after(() => env.cleanup());
beforeEach(() => {
  state.resetApiLimiters();
  state.apiRuntime.now = () => fixed;
});
afterEach(() => {
  state.apiRuntime.now = realNow;
});

const status = async (token: string) => (await router.handleApiRequest(apiRequest("GET", "/customers", { token }))).status;

describe("Token: Ablaufzeitpunkt", () => {
  it("expiresAt = jetzt: abgelaufen (401); eine Millisekunde später: gültig; eine Millisekunde früher: abgelaufen", async () => {
    const make = (offsetMs: number) => makeToken(env, { ownerPermissions: ["customers.view"], scope: ["customers.view"], expiresAt: new Date(fixed + offsetMs), rateLimitPerMinute: 6000 });
    assert.equal(await status((await make(0)).token), 401, "genau zur Ablaufzeit");
    assert.equal(await status((await make(-1)).token), 401, "eine Millisekunde davor abgelaufen");
    assert.equal(await status((await make(1)).token), 200, "eine Millisekunde bis zum Ablauf: gilt noch");
  });
});
