import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * Die kleinen Pipeline-Skripte, die bisher keinen eigenen Test hatten (Z6-4 L-6): `write-version.mjs`, `check-signing-key.mjs` und `db-migrate.mjs` als Kindprozesse.
 * `db-fresh.mjs` bleibt absichtlich ohne Test: Es löscht `dev.db` im Arbeitsverzeichnis des Entwicklers (kein Verzeichnis-Argument, nicht umlenkbar).
 */
const repo = path.resolve(import.meta.dirname, "../../..");
let work: string;
before(() => {
  work = mkdtempSync(path.join(tmpdir(), "so-small-scripts-"));
});
after(() => rmSync(work, { recursive: true, force: true }));

type Result = { ok: boolean; output: string };
const run = (script: string, args: string[] = [], env: Record<string, string | undefined> = {}): Result => {
  const base = { ...process.env };
  delete base.APP_VERSION;
  delete base.APP_COMMIT;
  delete base.RELEASE_SIGNING_KEY;
  const r = spawnSync(process.execPath, ["--no-warnings", path.join("scripts", script), ...args], { cwd: repo, env: { ...base, ...env }, encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stderr}${r.stdout}` };
};
const versionJson = (dir: string) => JSON.parse(readFileSync(path.join(dir, "version.json"), "utf8")) as Record<string, unknown>;
const out = (name: string) => {
  const dir = path.join(work, name);
  spawnSync(process.execPath, ["-e", `require("node:fs").mkdirSync(${JSON.stringify(dir)}, { recursive: true })`]);
  return dir;
};

describe("write-version.mjs", () => {
  const pkgVersion = (JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string }).version;
  const base = Number(readFileSync(path.join(repo, "docker/BASE_VERSION"), "utf8").trim());

  it("schreibt Version, Unterbau, Node-Version und Architektur; ohne Angabe „<package.json>-dev“", () => {
    const dir = out("v1");
    assert.ok(run("write-version.mjs", ["--out", dir]).ok);
    const json = versionJson(dir);
    assert.equal(json.version, `${pkgVersion}-dev`);
    assert.equal(json.base, base);
    assert.equal(json.node, process.version);
    assert.equal(json.arch, process.arch);
    assert.ok(!("commit" in json), "ohne Commit kein Feld");
  });

  it("--version und APP_VERSION (Vorrang: --version), Commit nur als 7 Zeichen Kleinbuchstaben und nur wenn gültig", () => {
    const a = out("v2");
    assert.ok(run("write-version.mjs", ["--out", a, "--version", "1.2.3", "--commit", "ABCDEF0123456789"], { APP_VERSION: "9.9.9" }).ok);
    assert.deepEqual([versionJson(a).version, versionJson(a).commit], ["1.2.3", "abcdef0"]);
    const b = out("v3");
    assert.ok(run("write-version.mjs", ["--out", b], { APP_VERSION: "2.0.0-rc.1", APP_COMMIT: "kein-hash" }).ok);
    assert.deepEqual([versionJson(b).version, "commit" in versionJson(b)], ["2.0.0-rc.1", false], "ein Wert, der kein Commit-Hash ist, wird verworfen");
  });

  it("lehnt ungültige Versionen ab und schreibt dann nichts", () => {
    for (const bad of ["1.2", "v1.2.3", "1.2.3 ", "1.2.3/../x", "", "1.2.3-"]) {
      const dir = out(`bad-${Math.random()}`);
      const r = run("write-version.mjs", ["--out", dir, "--version", bad || " "]);
      assert.equal(r.ok, false, `„${bad}“ wurde angenommen`);
      assert.match(r.output, /Ungültige Version/);
      assert.throws(() => readFileSync(path.join(dir, "version.json")));
    }
  });
});

describe("check-signing-key.mjs", () => {
  it("ohne Secret: Abbruch mit klarer Meldung", () => {
    const r = run("check-signing-key.mjs");
    assert.equal(r.ok, false);
    assert.match(r.output, /RELEASE_SIGNING_KEY ist nicht gesetzt/);
  });

  it("ein fremder Schlüssel wird nie akzeptiert – Abbruch (vor der Zeremonie am Wurzelschlüssel-Gate, danach an der Schlüsselkette), und der Schlüsselinhalt steht nirgends in der Ausgabe", () => {
    const foreign = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const r = run("check-signing-key.mjs", [], { RELEASE_SIGNING_KEY: foreign });
    assert.equal(r.ok, false);
    assert.match(r.output, /ist kein eigener Schlüssel|passt weder zum eingebauten Release-Schlüssel noch zu einem beglaubigten/);
    assert.ok(!/passt zum eingebauten|passt zum beglaubigten/.test(r.output), "kein Erfolg");
    const body = foreign.split("\n").filter((l) => l && !l.startsWith("-----"))[0]!;
    assert.ok(!r.output.includes(body), "der private Schlüssel darf nie ausgegeben werden");
  });
});

describe("db-migrate.mjs", () => {
  const head = readFileSync(path.join(repo, "prisma/migrations/00000000000000_baseline/migration.sql"), "utf8").split(/\r?\n/, 1)[0]!;

  it("solange die Baseline „unreleased“ ist, gibt es keine einzelnen Migrationen: Abbruch mit Hinweis auf db:baseline, nichts wird angelegt", { skip: !head.includes("unreleased") && "Baseline ist eingefroren" }, () => {
    const r = run("db-migrate.mjs", ["add_something"]);
    assert.equal(r.ok, false);
    assert.match(r.output, /npm run db:baseline/);
  });

  it("ab „frozen“ verlangt es einen Namen aus Kleinbuchstaben, Ziffern und Unterstrichen", { skip: head.includes("unreleased") && "Baseline ist noch nicht eingefroren" }, () => {
    for (const bad of [[], ["Gross"], ["mit-strich"], ["a b"], ["../x"]]) {
      const r = run("db-migrate.mjs", bad);
      assert.equal(r.ok, false);
      assert.match(r.output, /Aufruf: npm run db:migrate/);
    }
  });
});
