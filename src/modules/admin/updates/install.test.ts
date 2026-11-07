import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { makeReadOnly, removeTreeSync } from "@/lib/updates/fs-tree";
import { createEndorsement } from "@/lib/updates/keychain";
import { createSeal, sealFieldsFor } from "@/lib/updates/seal";
import { TEST_OTHER_ROOT, TEST_RELEASE, TEST_ROGUE, TEST_ROOT, TEST_SECOND, type TestKey } from "@/lib/updates/testdata/anchor/test-keys";
import { generateTree, nodeFs, serializeTree } from "@/lib/updates/tree";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import * as tar from "tar";
import { gzipSync } from "node:zlib";
import { rawTar, type RawEntry } from "@/test/tar";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Installation eines Release-Pakets gegen ein Fake-GitHub (Download per `fetch`): echtes tar.gz, Prüfsumme, Entpacken, Inhaltsprüfung,
 * Zustand/Zeiger, Sperre, Fehlerfälle. Der Neustart selbst gehört dem Aufrufer und ist hier nicht Gegenstand.
 */
let env: TestEnv;
let install: typeof import("./install");
let verifyModule: typeof import("./verify");
let store: typeof import("@/lib/updates/store");
let UpdateError: typeof import("./manifest").UpdateError;
const realFetch = globalThis.fetch;
const realCwd = process.cwd();
const work = mkdtempSync(path.join(tmpdir(), "so-install-"));

type Release = import("./releases").Release;

/** Das Siegel zu einem gebauten Paket (kommt im echten Release als eigenes Asset) */
const seals = new WeakMap<Buffer, Buffer>();

/**
 * Baut ein Paket mit den Dateien, die ein gültiges Release enthalten muss (ohne die in `omit` genannten), samt Dateiliste SOS-TREE und – für `release()` – Siegel.
 * `extra`: Dateien, die **nach** dem Erzeugen der Liste ins Paket kommen (Manipulation); `tamper`: Dateien, deren Inhalt danach verändert wird;
 * `signer`/`endorsedUntil`: Signaturschlüssel des Siegels (Testschlüssel).
 */
async function bundle(version: string, options: { base?: number; omit?: string[]; metaVersion?: string; extra?: string[]; tamper?: string[]; signer?: TestKey; endorsedUntil?: string; endorsedBy?: TestKey } = {}) {
  const dir = path.join(work, `pkg-${version}-${Math.random().toString(36).slice(2)}`);
  const files: Record<string, string> = {
    "version.json": JSON.stringify({ version: options.metaVersion ?? version, base: options.base ?? 1 }),
    "server.js": "// server",
    "launcher.mjs": "// launcher",
    "runtime/node": "node",
    "runtime/loader": "ld.so",
    "prisma/migrations/00000000000000_baseline/migration.sql": "-- sql",
  };
  for (const [name, content] of Object.entries(files)) {
    if (options.omit?.includes(name)) continue;
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  const tree = serializeTree(await generateTree(nodeFs(dir)));
  writeFileSync(path.join(dir, "SOS-TREE"), tree);
  for (const name of options.extra ?? []) writeFileSync(path.join(dir, name), "böse");
  for (const name of options.tamper ?? []) writeFileSync(path.join(dir, name), "verändert!!");
  const signer = options.signer ?? TEST_RELEASE;
  const seal = createSeal(sealFieldsFor(tree, { version, base: options.base ?? 1, arch: process.arch }), signer.privatePem, {
    builtInKeyPem: TEST_RELEASE.publicPem,
    endorsement: signer === TEST_RELEASE ? undefined : createEndorsement((options.endorsedBy ?? TEST_ROOT).privatePem, signer.publicPem, options.endorsedUntil ?? "2099-12-31"),
  });
  const archive = path.join(work, `${path.basename(dir)}.tar.gz`);
  await tar.c({ gzip: true, file: archive, cwd: dir }, [...Object.keys(files).filter((f) => !options.omit?.includes(f)), "SOS-TREE", ...(options.extra ?? [])]);
  const bytes = readFileSync(archive);
  seals.set(bytes, seal);
  return bytes;
}

function release(version: string, bytes: Buffer, overrides: Partial<Release["manifest"]> = {}): Release {
  const asset = `schrauberos-${version}.tar.gz`;
  return {
    version,
    notes: "",
    publishedAt: null,
    manifest: { schema: 1, version, base: 1, arch: process.arch, asset, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, ...overrides },
    bundle: { name: asset, url: `http://fake/asset/${asset}`, size: bytes.length },
    seal: seals.get(bytes) ?? Buffer.alloc(0),
  };
}

/** Fake-GitHub-Download: liefert die Bytes (oder einen Fehlerstatus) für die Asset-URL. */
function fakeDownload(answer: Buffer | number | "offline") {
  const requests: Array<{ url: string; auth: string | null }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization") });
    if (answer === "offline") throw new TypeError("fetch failed");
    if (typeof answer === "number") return new Response("fehler", { status: answer });
    return new Response(new Uint8Array(answer));
  }) as typeof fetch;
  return requests;
}

/** Fake-GitHub mit Weiterleitung: die Asset-Adresse der API antwortet mit 302 auf `target`, dort liegen die Bytes. */
function fakeRedirectingDownload(bytes: Buffer, target: string) {
  const requests: Array<{ url: string; auth: string | null }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    if (url === target) return new Response(new Uint8Array(bytes));
    return new Response(null, { status: 302, headers: { location: target } });
  }) as typeof fetch;
  return requests;
}

before(async () => {
  env = await createTestEnv();
  process.env.APP_UPDATER = "1";
  // Die „GitHub-API“ des Tests: Asset-Adressen liegen auf derselben Herkunft (nur dorthin darf das Token); `cdn.fake` ist der erlaubte Content-Server
  process.env.UPDATE_API_URL = "http://fake";
  process.env.UPDATE_REDIRECT_HOSTS = "cdn.fake";
  // „Laufende Version“ = version.json im Arbeitsverzeichnis
  const running = path.join(work, "running");
  mkdirSync(running, { recursive: true });
  writeFileSync(path.join(running, "version.json"), JSON.stringify({ version: "1.0.0", base: 1 }));
  process.chdir(running);
  const config = await import("./config");
  config.setTrustAnchorsForTest({ builtInKey: TEST_RELEASE.publicPem, rootKey: TEST_ROOT.publicPem });
  verifyModule = await import("./verify");
  install = await import("./install");
  store = await import("@/lib/updates/store");
  UpdateError = (await import("./manifest")).UpdateError;
});
after(async () => {
  process.chdir(realCwd);
  (await import("./config")).setTrustAnchorsForTest(null);
  verifyModule.setTreeVerifier(null);
  globalThis.fetch = realFetch;
  delete process.env.APP_UPDATER;
  delete process.env.UPDATE_API_URL;
  delete process.env.UPDATE_REDIRECT_HOSTS;
  removeTreeSync(store.updatesDir()); // installierte Versionen sind schreibgeschützt
  await env.cleanup();
  rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
  removeTreeSync(store.updatesDir()); // installierte Versionen sind schreibgeschützt
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const rejectsWith = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof UpdateError && error.code === code, `erwartet: ${code}`);

describe("installRelease", () => {
  it("lädt, prüft und entpackt das Paket, merkt die Version vor und setzt den Zeiger des Starters", async () => {
    const bytes = await bundle("1.1.0");
    const requests = fakeDownload(bytes);
    await install.installRelease(release("1.1.0", bytes));
    assert.equal(requests.length, 1);
    assert.ok(existsSync(path.join(store.versionDir("1.1.0"), "launcher.mjs")));
    assert.ok(existsSync(path.join(store.versionDir("1.1.0"), "runtime", "node")));
    const state = store.readState();
    assert.equal(state.current, "1.1.0");
    assert.equal(state.pending, true, "wartet auf die Bestätigung durch den Launcher");
    assert.equal(store.readActive(), store.versionDir("1.1.0"), "der Zeiger zeigt auf die neue Version");
    // keine Reste: Staging, temporäre Dateien, Sperre
    assert.deepEqual([".install.lock", "tmp"].filter((n) => existsSync(path.join(store.updatesDir(), n))), []);
    assert.equal(existsSync(path.join(store.versionsDir(), ".partial-1.1.0")), false);
  });

  it("merkt die bisherige Version als Rückfallebene und räumt ältere auf", async () => {
    store.writeState({ ...store.readState(), current: "1.0.5", previous: "1.0.4", pending: false });
    mkdirSync(store.versionDir("1.0.5"), { recursive: true });
    mkdirSync(store.versionDir("1.0.4"), { recursive: true });
    const bytes = await bundle("1.2.0");
    fakeDownload(bytes);
    await install.installRelease(release("1.2.0", bytes));
    const state = store.readState();
    assert.equal(state.current, "1.2.0");
    assert.equal(state.previous, "1.0.5");
    assert.equal(existsSync(store.versionDir("1.0.4")), false, "nur aktuelle und vorherige Version bleiben");
    assert.ok(existsSync(store.versionDir("1.0.5")));
  });

  it("lehnt ein Paket mit falscher Prüfsumme ab und hinterlässt nichts", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload(Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([bytes[bytes.length - 1] ^ 1])]));
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "badChecksum");
    assert.equal(store.readState().current, null);
    assert.equal(existsSync(store.versionDir("1.1.0")), false);
  });

  it("bricht ab, sobald mehr Bytes ankommen als das signierte Manifest erlaubt", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload(Buffer.concat([bytes, Buffer.alloc(2048)]));
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "tooLarge");
    assert.equal(store.readState().current, null);
  });

  it("meldet Netzwerkfehler und Fehlerstatus des Downloads", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload("offline");
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "network");
    fakeDownload(500);
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "network");
    assert.equal(existsSync(path.join(store.updatesDir(), ".install.lock")), false, "die Sperre wird auch bei Fehlern freigegeben");
  });

  it("lehnt Pakete ab, die nicht entpackt werden können oder nicht vollständig sind", async () => {
    const junk = Buffer.from("das ist kein tar.gz");
    fakeDownload(junk);
    await rejectsWith(install.installRelease(release("1.1.0", junk)), "extract");

    for (const missing of ["launcher.mjs", "server.js", "runtime/node", "runtime/loader", "prisma/migrations/00000000000000_baseline/migration.sql"]) {
      const bytes = await bundle("1.1.0", { omit: [missing] });
      fakeDownload(bytes);
      // ohne Migrationsdatei existiert das Verzeichnis prisma/migrations nicht mehr
      await rejectsWith(install.installRelease(release("1.1.0", bytes)), "invalidBundle");
    }
    const wrongVersion = await bundle("1.1.0", { metaVersion: "9.9.9" });
    fakeDownload(wrongVersion);
    await rejectsWith(install.installRelease(release("1.1.0", wrongVersion)), "invalidBundle");
    const wrongBase = await bundle("1.1.0", { base: 7 });
    fakeDownload(wrongBase);
    await rejectsWith(install.installRelease(release("1.1.0", wrongBase)), "invalidBundle");
    assert.equal(store.readState().current, null);
    assert.equal(existsSync(store.versionDir("1.1.0")), false);
  });

  it("lehnt Veraltetes, falschen Starter-Vertrag, wartende Bestätigung und deaktivierten Updater ab, ohne etwas herunterzuladen", async () => {
    const bytes = await bundle("1.1.0");
    const requests = fakeDownload(bytes);
    await rejectsWith(install.installRelease(release("1.0.0", bytes)), "notNewer");
    await rejectsWith(install.installRelease(release("0.9.0", bytes)), "notNewer");
    await rejectsWith(install.installRelease(release("1.1.0", bytes, { base: 2 })), "needsImage");
    await rejectsWith(install.installRelease(release("1.1.0", bytes, { arch: process.arch === "x64" ? "arm64" : "x64" })), "needsImage");
    store.writeState({ ...store.readState(), current: "1.0.5", pending: true });
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "pending");
    process.env.APP_UPDATER = "0";
    try {
      await rejectsWith(install.installRelease(release("1.1.0", bytes)), "disabled");
    } finally {
      process.env.APP_UPDATER = "1";
    }
    assert.equal(requests.length, 0);
  });

  it("nur ein Update gleichzeitig: eine frische Sperre blockiert, eine verwaiste (nach Absturz) verfällt", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload(bytes);
    const lock = path.join(store.updatesDir(), ".install.lock");
    mkdirSync(lock, { recursive: true });
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "busy");
    assert.ok(existsSync(lock), "die fremde Sperre bleibt unangetastet");
    const old = new Date(Date.now() - 31 * 60_000);
    utimesSync(lock, old, old);
    assert.ok(Date.now() - statSync(lock).mtimeMs > 30 * 60_000);
    await install.installRelease(release("1.1.0", bytes));
    assert.equal(store.readState().current, "1.1.0");
  });

  it("Weiterleitung des Downloads auf den GitHub-Content-Server: das Token geht nur an die API, nie an das Weiterleitungsziel (SEC-09)", async () => {
    const bytes = await bundle("1.1.0");
    await env.db.appSetting.deleteMany();
    const { setSecret } = await import("@/server/settings");
    await setSecret("update.token", "geheim-token-123");
    const requests = fakeRedirectingDownload(bytes, "http://cdn.fake/release-assets/abc?sig=1");
    await install.installRelease(release("1.1.0", bytes));
    assert.deepEqual(requests.map((r) => [new URL(r.url).host, r.auth]), [["fake", "Bearer geheim-token-123"], ["cdn.fake", null]]);
    assert.equal(store.readState().current, "1.1.0");
  });

  it("Weiterleitung auf einen Fremdhost: Abbruch (badRelease), der Fremdhost wird nie angefragt, nichts bleibt liegen (SEC-09)", async () => {
    const bytes = await bundle("1.1.0");
    const { setSecret } = await import("@/server/settings");
    await setSecret("update.token", "geheim-token-123");
    for (const evil of ["http://evil.example/steal", "http://cdn.fake.evil.example/x", "http://cdn.fake@evil.example/x", "ftp://cdn.fake/x"]) {
      const requests = fakeRedirectingDownload(bytes, evil);
      await rejectsWith(install.installRelease(release("1.1.0", bytes)), "badRelease");
      assert.deepEqual(requests.map((r) => new URL(r.url).host), ["fake"], evil);
    }
    assert.equal(store.readState().current, null);
    assert.equal(existsSync(store.versionDir("1.1.0")), false);
    assert.equal(existsSync(path.join(store.updatesDir(), ".install.lock")), false, "die Sperre wird freigegeben");
  });

  it("eine Asset-Adresse auf fremdem Host wird gar nicht angefragt – das Token verlässt die App nicht", async () => {
    const bytes = await bundle("1.1.0");
    const { setSecret } = await import("@/server/settings");
    await setSecret("update.token", "geheim-token-123");
    const requests = fakeDownload(bytes);
    const foreign = release("1.1.0", bytes);
    foreign.bundle.url = "http://evil.example/asset/schrauberos-1.1.0.tar.gz";
    await rejectsWith(install.installRelease(foreign), "badRelease");
    assert.equal(requests.length, 0);
  });

  it("lehnt Pakete mit Symlink nach außen, Hardlink, ..-Pfad, absolutem Pfad oder Geräte-Datei beim Entpacken ab (SEC-14) – nichts außerhalb, nichts liegt danach da", async () => {
    const base: RawEntry[] = [{ name: "version.json", data: JSON.stringify({ version: "1.1.0", base: 1 }) }, { name: "server.js", data: "//" }];
    const evil: Array<[string, RawEntry]> = [
      ["Symlink nach außen", { name: "runtime/lib/libx.so", type: "2", linkname: "../../../../etc/passwd" }],
      ["absoluter Symlink", { name: "runtime/lib/liby.so", type: "2", linkname: "/etc/passwd" }],
      ["Hardlink", { name: "hart", type: "1", linkname: "server.js" }],
      ["..-Pfad", { name: "../draussen.txt", data: "böse" }],
      ["Geräte-Datei", { name: "dev/null", type: "3" }],
    ];
    for (const [name, entry] of evil) {
      const bytes = gzipSync(rawTar([...base, entry]));
      fakeDownload(bytes);
      await rejectsWith(install.installRelease(release("1.1.0", bytes)), "extract");
      assert.equal(existsSync(store.versionDir("1.1.0")), false, name);
      assert.equal(existsSync(path.join(store.versionsDir(), ".partial-1.1.0")), false, name);
    }
    assert.equal(existsSync(path.join(work, "draussen.txt")), false);
    assert.equal(store.readState().current, null);
  });

  it("sendet das Update-Token nur als Autorisierungs-Kopf des Downloads", async () => {
    const bytes = await bundle("1.1.0");
    await env.db.appSetting.deleteMany();
    const { setSecret } = await import("@/server/settings");
    await setSecret("update.token", "geheim-token-123");
    const requests = fakeDownload(bytes);
    await install.installRelease(release("1.1.0", bytes));
    assert.equal(requests[0].auth, "Bearer geheim-token-123");
    assert.equal(requests[0].url.includes("geheim"), false, "das Token steht nie in der URL");
  });
});

describe("installRelease: Siegel und Prüfung vor der Aktivierung (Starter-Vertrauensanker)", () => {
  const nothingActivated = (version: string) => {
    assert.equal(store.readState().current, null, "der Zustand bleibt unberührt");
    assert.equal(store.readActive(), null, "der Zeiger bleibt leer");
    assert.equal(existsSync(store.versionDir(version)), false, "keine Version im Volume");
    assert.equal(existsSync(path.join(store.versionsDir(), `.partial-${version}`)), false, "kein Staging-Rest");
  };

  it("legt das Siegel in den Versionsordner; Liste und Siegel passen zum Inhalt; auf POSIX-Systemen ist der Baum schreibgeschützt", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload(bytes);
    const rel = release("1.1.0", bytes);
    await install.installRelease(rel);
    const dir = store.versionDir("1.1.0");
    assert.ok(readFileSync(path.join(dir, "SOS-SEAL")).equals(rel.seal), "das Siegel aus dem Release liegt im Versionsordner");
    assert.ok(existsSync(path.join(dir, "SOS-TREE")));
    if (process.platform !== "win32") {
      assert.equal(statSync(dir).mode & 0o222, 0, "Ordner schreibgeschützt");
      assert.equal(statSync(path.join(dir, "server.js")).mode & 0o222, 0, "Dateien schreibgeschützt");
      assert.throws(() => writeFileSync(path.join(dir, "neu.txt"), "x"), /EACCES|EPERM/);
    }
  });

  it("erbt der Ordner versions/ das Setgid-Bit („Gruppe vererben“ einer NAS-Freigabe), wird trotzdem installiert – ohne Setgid im Ergebnis (der Starter lehnte es mit 16 setid ab)", async (t) => {
    if (process.platform === "win32") return t.skip("keine POSIX-Modi");
    mkdirSync(store.versionsDir(), { recursive: true });
    chmodSync(store.versionsDir(), 0o2775);
    const probe = path.join(store.versionsDir(), ".probe");
    mkdirSync(probe);
    const inherits = (statSync(probe).mode & 0o2000) !== 0; // nicht jedes Dateisystem vererbt
    rmSync(probe, { recursive: true });
    const bytes = await bundle("1.1.0");
    fakeDownload(bytes);
    await install.installRelease(release("1.1.0", bytes));
    assert.equal(store.readState().current, "1.1.0", inherits ? "trotz vererbtem Setgid installiert" : "installiert");
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [path.join(dir, e.name), ...walk(path.join(dir, e.name))] : [path.join(dir, e.name)]));
    for (const p of [store.versionDir("1.1.0"), ...walk(store.versionDir("1.1.0"))]) assert.equal(statSync(p).mode & 0o7000, 0, p);
  });

  it("eine zusätzliche Datei im Paket (nicht in der Liste) wird abgelehnt: nichts wird aktiviert", async () => {
    const bytes = await bundle("1.1.0", { extra: ["backdoor.js"] });
    fakeDownload(bytes);
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "badTree");
    nothingActivated("1.1.0");
  });

  it("eine veränderte Datei wird abgelehnt", async () => {
    const bytes = await bundle("1.1.0", { tamper: ["server.js"] });
    fakeDownload(bytes);
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "badTree");
    nothingActivated("1.1.0");
  });

  it("ein Siegel, das ein nicht vertrauter Schlüssel signiert hat, ein fehlendes oder ein zerstörtes Siegel wird abgelehnt", async () => {
    const rogue = await bundle("1.1.0", { signer: TEST_ROGUE, endorsedBy: TEST_OTHER_ROOT });
    fakeDownload(rogue);
    await rejectsWith(install.installRelease(release("1.1.0", rogue)), "badTree");
    const good = await bundle("1.1.0");
    fakeDownload(good);
    await rejectsWith(install.installRelease({ ...release("1.1.0", good), seal: Buffer.alloc(0) }), "badTree");
    const broken = Buffer.from(seals.get(good)!);
    broken[broken.length - 20] = broken[broken.length - 20] === 0x30 ? 0x31 : 0x30;
    await rejectsWith(install.installRelease({ ...release("1.1.0", good), seal: broken }), "badTree");
    nothingActivated("1.1.0");
  });

  it("der Siegel-Schlüssel ist beglaubigt: gültig akzeptiert; abgelaufene Beglaubigung: eigener Fehler (Ablauf prüft nur die App, nie der Starter)", async () => {
    const endorsed = await bundle("1.1.0", { signer: TEST_SECOND });
    fakeDownload(endorsed);
    await install.installRelease(release("1.1.0", endorsed));
    assert.equal(store.readState().current, "1.1.0");
    store.writeState({ ...store.readState(), current: null, previous: null, pending: false }); // zurücksetzen
    removeTreeSync(store.versionDir("1.1.0"));
    const expired = await bundle("1.2.0", { signer: TEST_SECOND, endorsedUntil: "2026-01-31" });
    fakeDownload(expired);
    await rejectsWith(install.installRelease(release("1.2.0", expired)), "sealExpired");
    nothingActivated("1.2.0");
  });

  it("node_modules in einem Vorfahrenordner (versions/, app/, Datenverzeichnis) verhindert die Installation: Node würde dort Module nachladen", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload(bytes);
    for (const where of [store.versionsDir(), store.updatesDir(), path.dirname(store.updatesDir())]) {
      mkdirSync(path.join(where, "node_modules"), { recursive: true });
      await rejectsWith(install.installRelease(release("1.1.0", bytes)), "badTree");
      removeTreeSync(path.join(where, "node_modules"));
    }
    nothingActivated("1.1.0");
    await install.installRelease(release("1.1.0", bytes));
    assert.equal(store.readState().current, "1.1.0", "ohne node_modules oberhalb klappt es");
  });

  it("die Prüfung ist einspritzbar: der Installer ruft sie mit Staging-Ordner (inkl. Siegel) und Version auf; ihr Befund entscheidet", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload(bytes);
    const calls: Array<{ dir: string; version: string; hasSeal: boolean }> = [];
    verifyModule.setTreeVerifier(async ({ dir, version }) => {
      calls.push({ dir, version, hasSeal: existsSync(path.join(dir, "SOS-SEAL")) });
      return { ok: false, code: 15, reason: "extra", path: "x" };
    });
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "badTree");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].version, "1.1.0");
    assert.equal(calls[0].hasSeal, true);
    assert.match(path.basename(calls[0].dir), /^\.partial-1\.1\.0$/);
    nothingActivated("1.1.0");

    verifyModule.setTreeVerifier(async () => ({ ok: true, version: "1.1.0", files: 1, bytes: 1, ms: 1, floor: "above" }));
    await install.installRelease(release("1.1.0", bytes));
    assert.equal(store.readState().current, "1.1.0");
    verifyModule.setTreeVerifier(null);
  });

  it("veraltet/unverträglich (Code 19 des Prüfers) wird als „nicht neuer“ bzw. „neues Image nötig“ gemeldet, nicht als Integritätsfehler", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload(bytes);
    verifyModule.setTreeVerifier(async () => ({ ok: false, code: 19, reason: "floor" }));
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "notNewer");
    verifyModule.setTreeVerifier(async () => ({ ok: false, code: 19, reason: "base" }));
    await rejectsWith(install.installRelease(release("1.1.0", bytes)), "needsImage");
    verifyModule.setTreeVerifier(null);
  });

  it("die Untergrenze des Starters ist die eingebaute Version: eine Version, die nicht darüber liegt, wird schon beim Installieren abgewiesen", async () => {
    const builtinDir = path.join(work, "builtin-floor");
    mkdirSync(builtinDir, { recursive: true });
    writeFileSync(path.join(builtinDir, "version.json"), JSON.stringify({ version: "1.1.0", base: 1 }));
    process.env.BUILTIN_DIR = builtinDir;
    try {
      const bytes = await bundle("1.1.0");
      fakeDownload(bytes);
      await rejectsWith(install.installRelease(release("1.1.0", bytes)), "notNewer");
      const above = await bundle("1.2.0");
      fakeDownload(above);
      await install.installRelease(release("1.2.0", above));
    } finally {
      delete process.env.BUILTIN_DIR;
    }
    assert.equal(store.readState().current, "1.2.0");
  });

  it("dieselbe Version erneut installieren (Reparatur): ersetzt eine vorhandene, auch schreibgeschützte; hebt die Sperre auf", async () => {
    const bytes = await bundle("1.1.0");
    fakeDownload(bytes);
    await install.installRelease(release("1.1.0", bytes));
    // Zustand nach einem Integritätsbefund: Version gesperrt, Rückfall auf die eingebaute; der schreibgeschützte Baum liegt noch da
    await makeReadOnly(store.versionDir("1.1.0")).catch(() => undefined);
    store.writeState({ ...store.readState(), current: null, pending: false, failed: ["1.1.0"] });
    await install.installRelease(release("1.1.0", bytes));
    const state = store.readState();
    assert.equal(state.current, "1.1.0");
    assert.deepEqual(state.failed, [], "die Sperre ist aufgehoben");
    assert.ok(existsSync(path.join(store.versionDir("1.1.0"), "SOS-SEAL")));
  });

  it("räumt beim Aufräumen alter Versionen auch schreibgeschützte Bäume weg", async () => {
    const a = await bundle("1.1.0");
    fakeDownload(a);
    await install.installRelease(release("1.1.0", a));
    store.writeState({ ...store.readState(), pending: false });
    const b = await bundle("1.2.0");
    fakeDownload(b);
    await install.installRelease(release("1.2.0", b));
    store.writeState({ ...store.readState(), pending: false });
    const c = await bundle("1.3.0");
    fakeDownload(c);
    await install.installRelease(release("1.3.0", c));
    assert.equal(existsSync(store.versionDir("1.1.0")), false, "nur aktuelle und vorherige Version bleiben");
    assert.ok(existsSync(store.versionDir("1.2.0")));
  });
});
