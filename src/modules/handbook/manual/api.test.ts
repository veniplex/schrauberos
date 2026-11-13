import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Handbuch über die API (nur lesend): Seiten ohne Rollenbeschränkung, nie Seiten in Kapiteln für bestimmte Rollen, nie die IT-Dokumentation; Schreiben gibt es nicht. */
let env: TestEnv;
let router: typeof import("@/server/api/router");
let token: string;
const ids: Record<string, string> = {};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (method: string, path: string, body?: unknown, who = token) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token: who, body }));
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : {}) as Json };
};

before(async () => {
  env = await createTestEnv();
  for (const key of ["handbook.manual", "it.docs"]) await env.db.featureSetting.upsert({ where: { key }, update: { enabled: true }, create: { key, enabled: true, updatedByName: "Test" } });
  router = await import("@/server/api/router");
  token = (await makeToken(env, { admin: true, scope: ["manual.view", "manual.edit", "docs.view"] })).token;
  const open = await env.db.docCategory.create({ data: { area: "handbook", name: "Allgemein" } });
  const role = await env.role({ key: "leitung-doc" });
  const closed = await env.db.docCategory.create({ data: { area: "handbook", name: "Nur Leitung", roles: { create: [{ roleId: role.id }] } } });
  const page = (key: string, area: string, title: string, categoryId: string | null) => env.db.docPage.create({ data: { area, title, slug: key, content: `# ${title}\nInhalt ${key}`, categoryId } }).then((p) => void (ids[key] = p.id));
  await page("frei", "handbook", "Freie Seite", null);
  await page("offen", "handbook", "Offenes Kapitel", open.id);
  await page("zu", "handbook", "Leitungsseite", closed.id);
  await page("it", "it", "Zugangsdaten", null);
});
after(() => env.cleanup());

describe("Handbuch (nur lesend)", () => {
  it("Liste und Einzelseite: Seiten ohne Kapitel und in offenen Kapiteln; nie ein Kapitel mit Rollenbeschränkung, nie die IT-Dokumentation", async () => {
    const list = await call("GET", "/manual-pages?limit=100");
    assert.equal(list.status, 200);
    const slugs = (list.json.data as Array<{ slug: string }>).map((p) => p.slug).sort();
    assert.deepEqual(slugs, ["frei", "offen"]);
    const one = await call("GET", `/manual-pages/${ids.offen}`);
    assert.equal(one.status, 200);
    assert.equal(one.json.data.category, "Allgemein");
    assert.match(one.json.data.content, /Inhalt offen/);
    assert.equal((await call("GET", `/manual-pages/${ids.zu}`)).status, 404, "Kapitel für bestimmte Rollen");
    assert.equal((await call("GET", `/manual-pages/${ids.it}`)).status, 404, "IT-Dokumentation ist keine Ressource");
    const found = await call("GET", "/manual-pages?q=Offenes");
    assert.deepEqual((found.json.data as Array<{ slug: string }>).map((p) => p.slug), ["offen"]);
  });

  it("Schreiben gibt es nicht (405), und ohne manual.view im Scope 403", async () => {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const path = method === "POST" ? "/manual-pages" : `/manual-pages/${ids.frei}`;
      assert.ok([404, 405].includes((await call(method, path, { title: "x" })).status), method);
    }
    assert.equal(await env.db.docPage.count(), 4);
    const none = (await makeToken(env, { admin: true, scope: ["customers.view"] })).token;
    assert.equal((await call("GET", "/manual-pages", undefined, none)).status, 403);
  });
});
