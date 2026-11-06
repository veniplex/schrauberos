import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * `scripts/make-release.mjs` (läuft beim Tag-Build): bricht ab, solange der Wurzelschlüssel fehlt oder derselbe wie der
 * Release-Schlüssel ist – kein stilles Zurückfallen. Die Schlüsseldatei wird per RELEASE_KEY_FILE durch eine Testkopie ersetzt.
 */
const pem = (k: { export: (o: { type: "spki"; format: "pem" }) => string | Buffer }) => k.export({ type: "spki", format: "pem" }).toString();

let dir: string;
const release = generateKeyPairSync("ed25519");
const root = generateKeyPairSync("ed25519");

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "so-release-"));
  mkdirSync(path.join(dir, "bundle"));
  mkdirSync(path.join(dir, "out"));
  writeFileSync(path.join(dir, "bundle", "version.json"), JSON.stringify({ version: "1.2.3", base: 1, arch: "x64" }));
  writeFileSync(path.join(dir, "paket.tar.gz"), "inhalt");
});
after(() => rmSync(dir, { recursive: true, force: true }));

const keyFile = (rootExpression: string) => {
  const file = path.join(dir, "release-key.ts");
  writeFileSync(file, `export const RELEASE_PUBLIC_KEY = \`${pem(release.publicKey)}\`;\n${rootExpression}\n`);
  return file;
};

function run(keySource: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(process.execPath, ["scripts/make-release.mjs", "--archive", path.join(dir, "paket.tar.gz"), "--bundle", path.join(dir, "bundle"), "--out", path.join(dir, "out")], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: { ...process.env, RELEASE_KEY_FILE: keySource, RELEASE_SIGNING_KEY: release.privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string };
    return { ok: false, output: `${e.stderr ?? ""}${e.stdout ?? ""}` };
  }
}

describe("make-release.mjs und der Wurzelschlüssel", () => {
  it("bricht ab, wenn ROOT_PUBLIC_KEY noch die Zuweisung an RELEASE_PUBLIC_KEY ist (kein stilles Zurückfallen)", () => {
    const result = run(keyFile("export const ROOT_PUBLIC_KEY = RELEASE_PUBLIC_KEY;"));
    assert.equal(result.ok, false);
    assert.match(result.output, /ROOT_PUBLIC_KEY/);
    assert.equal(existsSync(path.join(dir, "out", "manifest.json")), false, "kein Manifest bei Abbruch");
  });

  it("bricht ab, wenn ROOT_PUBLIC_KEY dasselbe PEM wie der Release-Schlüssel ist", () => {
    const result = run(keyFile(`export const ROOT_PUBLIC_KEY = \`${pem(release.publicKey)}\`;`));
    assert.equal(result.ok, false);
    assert.match(result.output, /derselbe Schlüssel/);
    assert.equal(existsSync(path.join(dir, "out", "manifest.json")), false);
  });

  it("mit eigenem Wurzelschlüssel entsteht das signierte Manifest", () => {
    const result = run(keyFile(`export const ROOT_PUBLIC_KEY = \`${pem(root.publicKey)}\`;`));
    assert.equal(result.ok, true, result.output);
    assert.ok(existsSync(path.join(dir, "out", "manifest.json")));
    assert.ok(existsSync(path.join(dir, "out", "manifest.json.sig")));
  });
});
