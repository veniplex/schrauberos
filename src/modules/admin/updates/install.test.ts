import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import * as tar from "tar";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Installation eines Release-Pakets gegen ein Fake-GitHub (Download per `fetch`): echtes tar.gz, Prüfsumme, Entpacken, Inhaltsprüfung,
 * Zustand/Zeiger, Sperre, Fehlerfälle. Der Neustart selbst gehört dem Aufrufer und ist hier nicht Gegenstand.
 */
let env: TestEnv;
let install: typeof import("./install");
let store: typeof import("@/lib/updates/store");
let UpdateError: typeof import("./manifest").UpdateError;
const realFetch = globalThis.fetch;
const realCwd = process.cwd();
const work = mkdtempSync(path.join(tmpdir(), "so-install-"));

type Release = import("./releases").Release;

/** Baut ein Paket mit den Dateien, die ein gültiges Release enthalten muss (ohne die in `omit` genannten). */
async function bundle(version: string, options: { base?: number; omit?: string[]; metaVersion?: string } = {}) {
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
  const archive = path.join(work, `${path.basename(dir)}.tar.gz`);
  await tar.c({ gzip: true, file: archive, cwd: dir }, Object.keys(files).filter((f) => !options.omit?.includes(f)));
  return readFileSync(archive);
}

function release(version: string, bytes: Buffer, overrides: Partial<Release["manifest"]> = {}): Release {
  const asset = `schrauberos-${version}.tar.gz`;
  return {
    version,
    notes: "",
    publishedAt: null,
    manifest: { schema: 1, version, base: 1, arch: process.arch, asset, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, ...overrides },
    bundle: { name: asset, url: `http://fake/asset/${asset}`, size: bytes.length },
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

before(async () => {
  env = await createTestEnv();
  process.env.APP_UPDATER = "1";
  // „Laufende Version“ = version.json im Arbeitsverzeichnis
  const running = path.join(work, "running");
  mkdirSync(running, { recursive: true });
  writeFileSync(path.join(running, "version.json"), JSON.stringify({ version: "1.0.0", base: 1 }));
  process.chdir(running);
  install = await import("./install");
  store = await import("@/lib/updates/store");
  UpdateError = (await import("./manifest")).UpdateError;
});
after(async () => {
  process.chdir(realCwd);
  globalThis.fetch = realFetch;
  delete process.env.APP_UPDATER;
  await env.cleanup();
  rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(store.updatesDir(), { recursive: true, force: true });
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
