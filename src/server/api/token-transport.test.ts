import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Wie ein Token übergeben wird (Z6-4 M-1): ausschließlich `Authorization: Bearer <token>`. Ein Token in der Adresse (`?token=`, `?access_token=`, `?api_key=`), im Cookie, als `Basic`, in einem anderen
 * Kopf oder mit abweichender Form wird nie als Anmeldung gelesen (Adressen landen in Protokollen und im Verlauf) – 401, und im Fehlerpfad steht das Token nirgends (Log, Audit-Log, Antwort).
 */
let env: TestEnv;
let router: typeof import("./router");
let state: typeof import("./state");
let token: string;
const logged: string[] = [];
const real = { error: console.error, warn: console.warn, log: console.log };

before(async () => {
  env = await createTestEnv();
  router = await import("./router");
  state = await import("./state");
  state.apiLimits.failuresGlobal = 1_000_000;
  state.apiLimits.failuresPerIp = 1_000_000;
});
after(() => env.cleanup());
beforeEach(async () => {
  state.resetApiLimiters();
  token = (await makeToken(env, { ownerPermissions: ["customers.view"], scope: ["customers.view"], rateLimitPerMinute: 6000 })).token;
  logged.length = 0;
  for (const level of ["error", "warn", "log"] as const) console[level] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
});
afterEach(() => {
  Object.assign(console, real);
});

const send = async (path: string, headers: Record<string, string> = {}) => {
  const response = await router.handleApiRequest(apiRequest("GET", path, { headers }));
  return { status: response.status, text: await response.text(), headers: response.headers };
};
const b64 = (value: string) => Buffer.from(value).toString("base64");

describe("Token-Übergabe", () => {
  it("der richtige Weg geht (Bearer, Groß-/Kleinschreibung des Schemas egal)", async () => {
    assert.equal((await send("/customers", { authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await send("/customers", { authorization: `bearer ${token}` })).status, 200, "das Schema ist nach RFC 7235 nicht groß-/kleinschreibungsempfindlich");
  });

  it("Token in der Adresse, im Cookie oder in einem anderen Kopf: 401 – auch mit sonst gültigem Token", async () => {
    const attempts: Array<[string, string, Record<string, string>]> = [
      ["?token=", `/customers?token=${token}`, {}],
      ["?access_token=", `/customers?access_token=${token}`, {}],
      ["?api_key=", `/customers?api_key=${token}`, {}],
      ["?apikey=", `/customers?apikey=${token}`, {}],
      ["?authorization=", `/customers?authorization=Bearer%20${token}`, {}],
      ["Cookie", "/customers", { cookie: `token=${token}; so_session=${token}; access_token=${token}` }],
      ["X-Api-Key", "/customers", { "x-api-key": token }],
      ["X-Auth-Token", "/customers", { "x-auth-token": token }],
      ["X-Access-Token", "/customers", { "x-access-token": token }],
    ];
    for (const [label, path, headers] of attempts) {
      const r = await send(path, headers);
      assert.equal(r.status, 401, `${label}: erwartet 401, war ${r.status}`);
      assert.ok(!r.text.includes(token), `${label}: die Antwort wiederholt das Token nicht`);
    }
  });

  it("Basic, Digest, falsches Schema, doppelte Leerzeichen, Anhängsel, leeres oder gekürztes Token: 401", async () => {
    const variants: Array<[string, string]> = [
      ["Basic mit Token als Benutzer", `Basic ${b64(`${token}:`)}`],
      ["Basic mit Token als Passwort", `Basic ${b64(`api:${token}`)}`],
      ["Basic mit dem Token selbst", `Basic ${token}`],
      ["Digest", `Digest ${token}`],
      ["Token-Schema", `Token ${token}`],
      ["Bearer ohne Leerzeichen", `Bearer${token}`],
      ["Bearer mit zwei Leerzeichen", `Bearer  ${token}`],
      ["Bearer mit Anhängsel", `Bearer ${token} extra`],
      ["Bearer mit Komma", `Bearer ${token},Bearer ${token}`],
      ["Bearer mit Anführungszeichen", `Bearer "${token}"`],
      ["Bearer leer", "Bearer "],
      ["nur das Token", token],
      ["gekürzt", `Bearer ${token.slice(0, -1)}`],
      ["ein Zeichen zu viel", `Bearer ${token}x`],
      ["Großbuchstaben im Token", `Bearer ${token.toUpperCase()}`],
    ];
    for (const [label, header] of variants) {
      const r = await send("/customers", { authorization: header });
      assert.equal(r.status, 401, `${label}: erwartet 401, war ${r.status}`);
    }
  });

  it("der Fehlerpfad schreibt das Token nirgends hin: weder ins Log noch ins Audit-Log noch in die Antwort", async () => {
    await env.db.auditLog.deleteMany();
    const responses = [
      await send(`/customers?token=${token}`),
      await send("/customers", { authorization: `Basic ${b64(`${token}:`)}` }),
      await send("/customers", { authorization: `Bearer ${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}` }),
      await send("/customers", { cookie: `access_token=${token}` }),
    ];
    for (const r of responses) {
      assert.equal(r.status, 401);
      assert.ok(!r.text.includes(token) && !r.text.includes(token.slice(4, 24)));
    }
    const everything = JSON.stringify([logged, await env.db.auditLog.findMany()]);
    assert.ok(!everything.includes(token), "Klartext-Token im Log oder Audit");
    assert.ok(!everything.includes(token.slice(4, 24)), "auch kein Teil des Tokens");
  });
});
