import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Logo-Route (P3-5): öffentlich lesbar, nur Rasterbilder, ETag/304, keine Skriptmöglichkeit. */
let env: TestEnv;
let route: typeof import("./route");

before(async () => {
  env = await createTestEnv();
  route = await import("./route");
});
after(() => env.cleanup());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const get = (headers: Record<string, string> = {}) => route.GET(new NextRequest("http://localhost/api/logo", { headers }));
const store = (logoDataUrl: string | null) => env.db.workshop.upsert({ where: { id: "default" }, update: { logoDataUrl }, create: { id: "default", logoDataUrl } });

describe("GET /api/logo", () => {
  it("ohne Logo: 404, nichts zwischengespeichert", async () => {
    await store(null);
    env.signOut();
    const res = await get();
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("mit Logo: ohne Anmeldung lesbar; Typ, nosniff, sandbox, Zwischenspeicher mit ETag", async () => {
    await store(`data:image/png;base64,${PNG.toString("base64")}`);
    env.signOut();
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    assert.match(res.headers.get("cache-control") ?? "", /^public, max-age=\d+$/);
    assert.match(res.headers.get("etag") ?? "", /^"[0-9a-f]{32}"$/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  });

  it("If-None-Match mit dem ETag: 304 ohne Inhalt; ein geändertes Logo hat einen neuen ETag", async () => {
    await store(`data:image/png;base64,${PNG.toString("base64")}`);
    const etag = (await get()).headers.get("etag")!;
    const same = await get({ "if-none-match": etag });
    assert.equal(same.status, 304);
    assert.equal((await same.arrayBuffer()).byteLength, 0);
    await store(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]).toString("base64")}`);
    const changed = await get({ "if-none-match": etag });
    assert.equal(changed.status, 200);
    assert.equal(changed.headers.get("content-type"), "image/jpeg");
    assert.notEqual(changed.headers.get("etag"), etag);
  });

  it("ein früher gespeichertes SVG (oder anderer Inhalt) wird nie ausgeliefert: 404", async () => {
    for (const bad of [`data:image/svg+xml;base64,${Buffer.from("<svg onload='alert(1)'/>").toString("base64")}`, "data:text/html;base64,PGI+", "kaputt"]) {
      await store(bad);
      assert.equal((await get()).status, 404, bad.slice(0, 30));
    }
  });
});
