import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createEndorsement } from "@/lib/updates/keychain";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Schlüsselkette im Update-Ablauf (gegen ein Fake-GitHub): Release mit neuem, beglaubigtem Schlüssel wird akzeptiert, ein nicht beglaubigter abgelehnt. */
const pair = () => generateKeyPairSync("ed25519");
const pub = (k: ReturnType<typeof pair>) => k.publicKey.export({ type: "spki", format: "pem" }).toString();
const priv = (k: ReturnType<typeof pair>) => k.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const root = pair();
const builtIn = pair();
const rotated = pair();
const rogue = pair();

let env: TestEnv;
let releases: typeof import("./releases");
let store: typeof import("@/lib/updates/store");
const realFetch = globalThis.fetch;

const manifest = { schema: 1, version: "9.9.9", base: 1, arch: "x64", asset: "schrauberos-9.9.9.tar.gz", sha256: "a".repeat(64), size: 1000 };
const manifestBytes = Buffer.from(JSON.stringify(manifest));

/** Fake-GitHub: neuestes Release mit Manifest, Signatur des gegebenen Schlüssels und optional release-keys.json */
function fakeGithub(signer: ReturnType<typeof pair>, keysFile?: unknown) {
  const files = new Map<string, Buffer>([
    ["manifest.json", manifestBytes],
    ["manifest.json.sig", sign(null, manifestBytes, signer.privateKey)],
    ["schrauberos-9.9.9.tar.gz", Buffer.alloc(0)],
    ...(keysFile ? ([["release-keys.json", Buffer.from(JSON.stringify(keysFile))]] as Array<[string, Buffer]>) : []),
  ]);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/releases/latest")) {
      const assets = [...files].map(([name, data]) => ({ name, url: `http://fake/asset/${name}`, size: data.length }));
      return Response.json({ tag_name: "v9.9.9", body: "", published_at: null, assets });
    }
    const data = files.get(url.split("/asset/")[1] ?? "");
    return data ? new Response(new Uint8Array(data)) : new Response("nicht gefunden", { status: 404 });
  }) as typeof fetch;
}

before(async () => {
  env = await createTestEnv();
  process.env.UPDATE_PUBLIC_KEY = pub(builtIn);
  process.env.UPDATE_ROOT_PUBLIC_KEY = pub(root);
  process.env.UPDATE_API_URL = "http://fake";
  releases = await import("./releases");
  store = await import("@/lib/updates/store");
});
after(async () => {
  globalThis.fetch = realFetch;
  delete process.env.UPDATE_PUBLIC_KEY;
  delete process.env.UPDATE_ROOT_PUBLIC_KEY;
  delete process.env.UPDATE_API_URL;
  await env.cleanup();
});
beforeEach(() => store.writeEndorsements([]));

describe("Release-Prüfung mit Schlüsselkette", () => {
  it("akzeptiert ein Release, das mit dem eingebauten Schlüssel signiert ist", async () => {
    fakeGithub(builtIn);
    const check = await releases.checkLatestRelease(true);
    assert.ok("release" in check, JSON.stringify(check));
  });

  it("akzeptiert ein Release mit neuem Schlüssel, den der Wurzelschlüssel beglaubigt hat, und merkt sich die Beglaubigung", async () => {
    const endorsement = createEndorsement(priv(root), pub(rotated), "2099-12-31");
    fakeGithub(rotated, { keys: [endorsement] });
    assert.ok("release" in (await releases.checkLatestRelease(true)));
    assert.deepEqual(store.readEndorsements(), [endorsement]);
    assert.equal(existsSync(path.join(env.dir, "app", "release-keys.json")), true);

    // Später genügt die gemerkte Beglaubigung, das Release bringt sie nicht mehr mit
    fakeGithub(rotated);
    assert.ok("release" in (await releases.checkLatestRelease(true)));
  });

  it("lehnt ein Release mit nicht beglaubigtem Schlüssel ab – auch mit selbst ausgestellter Beglaubigung", async () => {
    fakeGithub(rogue);
    assert.deepEqual(await releases.checkLatestRelease(true).then((c) => ("error" in c ? c.error : "ok")), "badSignature");
    fakeGithub(rogue, { keys: [createEndorsement(priv(rogue), pub(rogue), "2099-12-31")] });
    assert.deepEqual(await releases.checkLatestRelease(true).then((c) => ("error" in c ? c.error : "ok")), "badSignature");
    assert.deepEqual(store.readEndorsements(), [], "ungültige Beglaubigungen werden nicht gemerkt");
  });

  it("eine kaputte Schlüsselliste macht ein korrekt signiertes Release nicht unlesbar", async () => {
    fakeGithub(builtIn, "kein json {");
    assert.ok("release" in (await releases.checkLatestRelease(true)));
  });
});
