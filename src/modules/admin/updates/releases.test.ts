import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createEndorsement, manifestSignedBytes, type Endorsement } from "@/lib/updates/keychain";
import { createSeal, sealFieldsFor, type SealFields } from "@/lib/updates/seal";
import { serializeTree } from "@/lib/updates/tree";
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

/**
 * Fake-GitHub: neuestes Release mit Manifest (Kontext + Manifest signiert), Siegel (SOS-SEAL), Signatur des gegebenen Schlüssels und optional release-keys.json.
 * Ist `signer` nicht der eingebaute Schlüssel, trägt das Siegel eine Beglaubigung (`endorsement`, Standard: vom Wurzelschlüssel, gültig bis 2099).
 */
function fakeGithub(signer: ReturnType<typeof pair>, keysFile?: unknown, options: { seal?: Buffer | null; sealOver?: Partial<SealFields>; endorsement?: Endorsement } = {}) {
  const tree = serializeTree([]);
  const fields = { ...sealFieldsFor(tree, { version: manifest.version, base: manifest.base, arch: manifest.arch }), ...options.sealOver };
  const endorsement = signer === builtIn ? undefined : (options.endorsement ?? createEndorsement(priv(root), pub(signer), "2099-12-31"));
  const seal = options.seal === undefined ? createSeal(fields, priv(signer), { builtInKeyPem: pub(builtIn), endorsement }) : options.seal;
  const files = new Map<string, Buffer>([
    ["manifest.json", manifestBytes],
    ["manifest.json.sig", sign(null, manifestSignedBytes(manifestBytes), signer.privateKey)],
    ["schrauberos-9.9.9.tar.gz", Buffer.alloc(0)],
    ...(seal ? ([["SOS-SEAL", seal]] as Array<[string, Buffer]>) : []),
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
  process.env.UPDATE_API_URL = "http://fake";
  (await import("./config")).setTrustAnchorsForTest({ builtInKey: pub(builtIn), rootKey: pub(root) });
  releases = await import("./releases");
  store = await import("@/lib/updates/store");
});
after(async () => {
  globalThis.fetch = realFetch;
  (await import("./config")).setTrustAnchorsForTest(null);
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

describe("Siegel (SOS-SEAL) im Release", () => {
  const errorOf = async () => {
    const check = await releases.checkLatestRelease(true);
    return "error" in check ? check.error : "ok";
  };

  it("das Siegel wird vor dem Download des Pakets geprüft und liegt im Release (Form A mit dem eingebauten Schlüssel, Form B mit beglaubigtem)", async () => {
    fakeGithub(builtIn);
    const a = await releases.checkLatestRelease(true);
    assert.ok("release" in a && a.release.seal.length > 100);
    fakeGithub(rotated, { keys: [createEndorsement(priv(root), pub(rotated), "2099-12-31")] });
    const b = await releases.checkLatestRelease(true);
    assert.ok("release" in b && b.release.seal.toString().includes("endorsement-sig "));
  });

  it("ohne Siegel, mit zu großem, zerstörtem, fremd signiertem oder nicht zum Manifest passendem Siegel gibt es kein installierbares Release", async () => {
    fakeGithub(builtIn, undefined, { seal: null });
    assert.equal(await errorOf(), "badRelease", "Siegel fehlt");
    fakeGithub(builtIn, undefined, { seal: Buffer.alloc(9000, 0x61) });
    assert.equal(await errorOf(), "badRelease", "zu groß");
    fakeGithub(builtIn, undefined, { seal: Buffer.from("kein Siegel\n") });
    assert.equal(await errorOf(), "badRelease", "formal fehlerhaft");
    fakeGithub(builtIn, undefined, { sealOver: { version: "9.9.8" } });
    assert.equal(await errorOf(), "badRelease", "Version passt nicht zum Manifest");
    fakeGithub(builtIn, undefined, { sealOver: { base: 7 } });
    assert.equal(await errorOf(), "badRelease", "base passt nicht zum Manifest");
    fakeGithub(builtIn, undefined, { sealOver: { arch: "arm64" } });
    assert.equal(await errorOf(), "badRelease", "arch passt nicht zum Manifest");
  });

  it("ein Siegel mit einem Schlüssel, den der Wurzelschlüssel nicht beglaubigt hat, wird abgelehnt – auch wenn das Manifest passt", async () => {
    // Manifest vom eingebauten Schlüssel, Siegel vom Fremden mit selbst ausgestellter Beglaubigung
    fakeGithub(builtIn, undefined, { seal: createSeal(sealFieldsFor(serializeTree([]), { version: "9.9.9", base: 1, arch: "x64" }), priv(rogue), { builtInKeyPem: pub(builtIn), endorsement: createEndorsement(priv(rogue), pub(rogue), "2099-12-31") }) });
    assert.equal(await errorOf(), "badSignature");
  });

  it("eine abgelaufene Beglaubigung im Siegel: eigener Fehler (die App prüft den Ablauf, der Starter nie)", async () => {
    fakeGithub(rotated, { keys: [createEndorsement(priv(root), pub(rotated), "2099-12-31")] }, { endorsement: createEndorsement(priv(root), pub(rotated), "2026-01-31") });
    assert.equal(await errorOf(), "sealExpired");
  });
});

describe("Kleine Assets: Größe wird auch beim Lesen begrenzt (ZP3 Kleinigkeit)", () => {
  it("readCapped liest bis zur Grenze und bricht darüber ab (die gemeldete Größe ist nur eine Angabe der Gegenseite)", async () => {
    const stream = (chunks: number[]) => new ReadableStream<Uint8Array>({ start: (c) => (chunks.forEach((n) => c.enqueue(new Uint8Array(n))), c.close()) });
    assert.equal((await releases.readCapped(stream([100, 200]), 1000))?.length, 300);
    assert.equal(await releases.readCapped(stream([600, 600]), 1000), null, "mehr als erlaubt, obwohl jeder Block klein ist");
    assert.equal((await releases.readCapped(null, 10))?.length, 0);
    assert.equal((await releases.readCapped(stream([1000]), 1000))?.length, 1000, "genau die Grenze ist erlaubt");
  });

  it("ein Asset, das weniger meldet als es liefert (Gegenseite lügt), macht das Release ungültig statt den Speicher zu füllen", async () => {
    fakeGithub(builtIn);
    const honest = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/asset/manifest.json")) return new Response(new Uint8Array(releases.SMALL_ASSET_MAX_BYTES + 1));
      return honest(input, init);
    }) as typeof fetch;
    const check = await releases.checkLatestRelease(true);
    assert.equal("error" in check ? check.error : "ok", "badRelease");
  });
});

describe("Änderungsprotokoll („Was ist neu“)", () => {
  const withNotes = (handler: (url: string) => Response | Promise<Response>) => {
    releases.clearNotesCacheForTest();
    globalThis.fetch = (async (input: string | URL | Request) => handler(String(input))) as typeof fetch;
  };

  it("liefert die Notizen des Releases der Version (Tag v<version>) samt Veröffentlichungsdatum", async () => {
    const urls: string[] = [];
    withNotes((url) => {
      urls.push(url);
      return Response.json({ tag_name: "v1.2.3", body: "## Neu - etwas", published_at: "2026-05-01T10:00:00Z", assets: [] });
    });
    assert.deepEqual(await releases.fetchReleaseNotes("1.2.3"), { version: "1.2.3", notes: "## Neu - etwas", publishedAt: "2026-05-01T10:00:00Z" });
    assert.match(urls[0], /\/releases\/tags\/v1\.2\.3$/);
    // zweiter Aufruf kommt aus dem Zwischenspeicher
    await releases.fetchReleaseNotes("1.2.3");
    assert.equal(urls.length, 1);
  });

  it("ohne Release, ohne Text, offline oder bei Entwicklungsständen: null (die Seite bleibt benutzbar), kein Wurf", async () => {
    withNotes(() => new Response("nicht gefunden", { status: 404 }));
    assert.equal(await releases.fetchReleaseNotes("7.7.7"), null);
    withNotes(() => Response.json({ body: "   " }));
    assert.equal(await releases.fetchReleaseNotes("7.7.7"), null);
    withNotes(() => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await releases.fetchReleaseNotes("7.7.7"), null);
    let called = false;
    withNotes(() => {
      called = true;
      return Response.json({ body: "x" });
    });
    for (const dev of ["0.1.0-dev", "0.0.0-dev", "0.1.0-dev.abc1234", "../etc", ""]) assert.equal(await releases.fetchReleaseNotes(dev), null, dev);
    assert.equal(called, false, "für Entwicklungsstände wird gar nicht erst angefragt");
  });

  it("offline: die einmal geholten Notizen stehen als Kopie im Datenverzeichnis und werden gezeigt, wenn GitHub nicht antwortet", async () => {
    withNotes(() => Response.json({ body: "Neu in 4.5.6", published_at: "2026-06-02T00:00:00Z" }));
    assert.equal((await releases.fetchReleaseNotes("4.5.6"))!.notes, "Neu in 4.5.6");
    assert.equal(store.readNotesCopy("4.5.6"), "Neu in 4.5.6");
    withNotes(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(await releases.fetchReleaseNotes("4.5.6"), { version: "4.5.6", notes: "Neu in 4.5.6", publishedAt: null, fromCopy: true });
    assert.equal(await releases.fetchReleaseNotes("4.5.7"), null, "ohne Kopie und ohne Netz gibt es nichts");
    assert.equal(store.readNotesCopy("../../x"), null, "nur gültige Versionsnummern werden als Dateiname benutzt");
  });

  it("sehr lange Notizen werden gekürzt", async () => {
    withNotes(() => Response.json({ body: "x".repeat(releases.NOTES_MAX_CHARS + 5000) }));
    assert.equal((await releases.fetchReleaseNotes("1.2.3"))!.notes.length, releases.NOTES_MAX_CHARS);
  });
});
