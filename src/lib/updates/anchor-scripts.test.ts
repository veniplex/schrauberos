import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createEndorsement, pemToRawKey } from "./keychain.ts";
import { verifySeal } from "./seal.ts";
import { TEST_OTHER_ROOT, TEST_RELEASE, TEST_SECOND, TEST_ROOT } from "./testdata/anchor/test-keys.ts";
import { parseTree } from "./tree.ts";

/**
 * Die Pipeline-Skripte des Starter-Vertrauensankers (scripts/gen-tree.mjs, make-seal.mjs, gen-trust-header.mjs, endorse-release-key.mjs) als Kindprozesse – mit
 * **Testschlüsseln** (testdata/anchor/test-keys.ts), nie mit echten.
 */
const repo = path.resolve(import.meta.dirname, "../../..");
let work: string;
before(() => {
  work = mkdtempSync(path.join(tmpdir(), "so-scripts-"));
});
after(() => rmSync(work, { recursive: true, force: true }));

type Result = { ok: boolean; output: string };
function run(script: string, args: string[], env: Record<string, string> = {}): Result {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join("scripts", script), ...args], { cwd: repo, env: { ...process.env, ...env }, encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stderr}${r.stdout}` };
}

const keyFile = (dir: string, root: { publicPem: string } | null, release = TEST_RELEASE) => {
  const file = path.join(dir, "release-key.ts");
  writeFileSync(file, `export const RELEASE_PUBLIC_KEY = \`${release.publicPem}\`;\n${root ? `export const ROOT_PUBLIC_KEY = \`${root.publicPem}\`;` : "export const ROOT_PUBLIC_KEY = RELEASE_PUBLIC_KEY;"}\n`);
  return file;
};

function bundleDir(name: string, version = "1.2.3") {
  const dir = path.join(work, name);
  mkdirSync(path.join(dir, "sub"), { recursive: true });
  writeFileSync(path.join(dir, "version.json"), JSON.stringify({ version, base: 4, arch: "x64" }));
  writeFileSync(path.join(dir, "server.js"), "// x");
  writeFileSync(path.join(dir, "sub", "a.txt"), "a");
  return dir;
}

describe("gen-tree.mjs", () => {
  it("schreibt SOS-TREE, ist wiederholbar (die alte Liste zählt nicht mit) und die Liste ist gültig", () => {
    const dir = bundleDir("tree");
    const first = run("gen-tree.mjs", [dir]);
    assert.equal(first.ok, true, first.output);
    const bytes = readFileSync(path.join(dir, "SOS-TREE"));
    assert.deepEqual(parseTree(bytes).map((e) => e.path), ["server.js", "sub", "sub/a.txt", "version.json"]);
    assert.equal(run("gen-tree.mjs", [dir]).ok, true);
    assert.ok(readFileSync(path.join(dir, "SOS-TREE")).equals(bytes), "gleiche Eingabe, gleiche Bytes");
  });

  it("bricht bei unzulässigen Namen ab und schreibt keine Liste", () => {
    const dir = bundleDir("tree-bad");
    writeFileSync(path.join(dir, "bad�name"), "x"); // U+FFFD: so wird ein Nicht-UTF-8-Name von Node gemeldet (Windows kennt keine Steuerzeichen in Namen)
    const result = run("gen-tree.mjs", [dir]);
    assert.equal(result.ok, false);
    assert.match(result.output, /Steuerzeichen/);
    assert.equal(existsSync(path.join(dir, "SOS-TREE")), false);
  });
});

describe("make-seal.mjs", () => {
  const env = (extra: Record<string, string> = {}, signer = TEST_RELEASE, root = TEST_ROOT) => ({
    RELEASE_SIGNING_KEY: signer.privatePem,
    RELEASE_KEY_FILE: keyFile(work, root),
    RELEASE_KEYS_FILE: path.join(work, "keine-beglaubigungen.json"),
    ...extra,
  });
  const trust = { releaseKey: pemToRawKey(TEST_RELEASE.publicPem)!, rootKey: pemToRawKey(TEST_ROOT.publicPem)! };

  it("siegelt ein Paket mit dem Release-Schlüssel; das Siegel besteht die Prüfung", () => {
    const dir = bundleDir("seal-a");
    assert.equal(run("gen-tree.mjs", [dir]).ok, true);
    const out = path.join(work, "out-a");
    mkdirSync(out);
    const result = run("make-seal.mjs", ["--bundle", dir, "--out", out], env());
    assert.equal(result.ok, true, result.output);
    const seal = verifySeal(readFileSync(path.join(out, "SOS-SEAL")), trust, null);
    assert.ok(seal.ok && seal.seal.version === "1.2.3" && seal.seal.base === 4 && seal.seal.treeEntries === 4);
    assert.equal(seal.ok && seal.seal.treeSha512, createHash("sha512").update(readFileSync(path.join(dir, "SOS-TREE"))).digest("hex"));
  });

  it("verweigert ein Paket, das von seiner Liste abweicht (kein Siegel für Unpassendes)", () => {
    const dir = bundleDir("seal-bad");
    run("gen-tree.mjs", [dir]);
    writeFileSync(path.join(dir, "zusaetzlich.txt"), "x");
    const out = path.join(work, "out-bad");
    mkdirSync(out);
    const result = run("make-seal.mjs", ["--bundle", dir, "--out", out], env());
    assert.equal(result.ok, false);
    assert.match(result.output, /weicht von SOS-TREE ab/);
    assert.equal(existsSync(path.join(out, "SOS-SEAL")), false);
  });

  it("verweigert ohne eigenen Wurzelschlüssel und ohne Liste", () => {
    const dir = bundleDir("seal-noroot");
    run("gen-tree.mjs", [dir]);
    const out = path.join(work, "out-noroot");
    mkdirSync(out);
    const noRoot = run("make-seal.mjs", ["--bundle", dir, "--out", out], { ...env(), RELEASE_KEY_FILE: keyFile(work, null) });
    assert.equal(noRoot.ok, false);
    assert.match(noRoot.output, /ROOT_PUBLIC_KEY/);
    const noTree = bundleDir("seal-notree");
    assert.equal(run("make-seal.mjs", ["--bundle", noTree, "--out", out], env()).ok, false);
  });

  describe("mit beglaubigtem Schlüssel", () => {
    const keysFile = (until: string, signedBy = TEST_ROOT) => {
      const file = path.join(work, `keys-${until}-${signedBy.name.replace(/\W/g, "")}.json`);
      writeFileSync(file, JSON.stringify({ keys: [createEndorsement(signedBy.privatePem, TEST_SECOND.publicPem, until)] }));
      return file;
    };
    const attempt = (until: string, now: string, signedBy = TEST_ROOT) => {
      const dir = bundleDir(`seal-b-${until}-${now}-${signedBy.name.replace(/\W/g, "")}`);
      run("gen-tree.mjs", [dir]);
      const out = path.join(dir, "..", `out-${path.basename(dir)}`);
      mkdirSync(out);
      const result = run("make-seal.mjs", ["--bundle", dir, "--out", out], env({ RELEASE_KEYS_FILE: keysFile(until, signedBy), SOS_NOW: now }, TEST_SECOND));
      return { result, seal: existsSync(path.join(out, "SOS-SEAL")) ? readFileSync(path.join(out, "SOS-SEAL")) : null };
    };

    it("bettet die Beglaubigung ins Siegel ein (Form B)", () => {
      const { result, seal } = attempt("2099-12-31", "2026-11-07");
      assert.equal(result.ok, true, result.output);
      assert.ok(seal);
      const verified = verifySeal(seal, trust, null);
      assert.ok(verified.ok && verified.seal.signingKey === TEST_SECOND.publicHex && verified.seal.endorsedUntil === "2099-12-31");
    });

    it("verweigert, wenn die Beglaubigung in weniger als 90 Tagen abläuft; warnt unter 180; ab 180 still", () => {
      const soon = attempt("2027-01-15", "2026-11-07");
      assert.equal(soon.result.ok, false);
      assert.match(soon.result.output, /weniger als 90 Tagen/);
      assert.equal(soon.seal, null);
      const warn = attempt("2027-04-15", "2026-11-07");
      assert.equal(warn.result.ok, true, warn.result.output);
      assert.match(warn.result.output, /warning/);
      const fine = attempt("2028-04-15", "2026-11-07");
      assert.equal(fine.result.ok, true);
      assert.doesNotMatch(fine.result.output, /warning/);
    });

    it("eine abgelaufene oder von fremder Wurzel ausgestellte Beglaubigung zählt nicht", () => {
      assert.equal(attempt("2026-01-31", "2026-11-07").result.ok, false);
      const foreign = attempt("2099-12-31", "2026-11-07", TEST_OTHER_ROOT);
      assert.equal(foreign.result.ok, false);
      assert.match(foreign.result.output, /keine gültige Beglaubigung/);
    });
  });
});

describe("gen-trust-header.mjs", () => {
  const header = (extra: string[], root: { publicPem: string } | null = TEST_ROOT, release = TEST_RELEASE, env: Record<string, string> = {}) => {
    const out = path.join(work, `trust-${Math.random().toString(36).slice(2)}.h`);
    const result = run("gen-trust-header.mjs", ["--out", out, "--release-key-file", keyFile(work, root, release), ...extra], env);
    return { result, text: existsSync(out) ? readFileSync(out, "utf8") : "" };
  };

  it("schreibt Schlüssel roh, Untergrenze als Tripel mit Vorabflag, base und Architektur", () => {
    const { result, text } = header(["--version", "0.2.0-dev.abc1234", "--arch", "x64"]);
    assert.equal(result.ok, true, result.output);
    assert.match(text, /#define SOS_FLOOR_MAJOR 0\n#define SOS_FLOOR_MINOR 2\n#define SOS_FLOOR_PATCH 0\n#define SOS_FLOOR_PRERELEASE 1/);
    assert.match(text, /#define SOS_ARCH "x64"/);
    assert.match(text, /#define SOS_BASE \d+/);
    const hexOf = (name: string) => [...text.matchAll(new RegExp(`${name}\\[32\\] = \\{([^}]*)\\}`, "g"))][0][1].match(/0x[0-9a-f]{2}/g)!.map((b) => b.slice(2)).join("");
    assert.equal(hexOf("SOS_ROOT_KEY"), TEST_ROOT.publicHex);
    assert.equal(hexOf("SOS_RELEASE_KEY"), TEST_RELEASE.publicHex);
    assert.match(header(["--version", "1.4.7"]).text, /SOS_FLOOR_PRERELEASE 0/);
    assert.equal(header(["--version", "kein-semver"]).result.ok, false);
  });

  it("Wurzelgate: ein Tag-Build bricht ab bei fehlender oder gleicher Wurzel und bei Testschlüsseln; ohne Tag-Build nur eine Warnung", () => {
    const equal = header(["--tag-build"], TEST_RELEASE);
    assert.equal(equal.result.ok, false);
    assert.match(equal.result.output, /derselbe Schlüssel/);
    assert.equal(equal.text, "", "kein Header bei Abbruch");
    const missing = header(["--tag-build"], null);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.output, /kein eigener Schlüssel/);
    const viaEnv = header([], TEST_RELEASE, TEST_RELEASE, { SOS_TAG_BUILD: "1" });
    assert.equal(viaEnv.result.ok, false, "auch über das Build-Arg des Dockerfiles");
    const testKeys = header(["--tag-build"]);
    assert.equal(testKeys.result.ok, false);
    assert.match(testKeys.result.output, /Testschlüssel/);
    const dev = header([], null);
    assert.equal(dev.result.ok, true, dev.result.output);
    assert.match(dev.result.output, /Warnung/);
  });
});

describe("endorse-release-key.mjs", () => {
  it("lehnt ein Ablaufdatum über fünf Jahre in der Zukunft und unechte Datumsangaben ab (bevor irgendetwas geschrieben wird)", () => {
    const rootFile = path.join(work, "root-private.pem");
    writeFileSync(rootFile, TEST_ROOT.privatePem);
    const publicFile = path.join(work, "release-public.pem");
    writeFileSync(publicFile, TEST_SECOND.publicPem);
    const far = `${new Date().getUTCFullYear() + 6}-01-01`;
    for (const date of [far, "2031-02-30", "morgen"]) {
      const result = run("endorse-release-key.mjs", ["--public", publicFile, "--valid-until", date], { ROOT_SIGNING_KEY_FILE: rootFile });
      assert.equal(result.ok, false, date);
    }
  });
});

describe("Generalprobe und Baumprüfung", () => {
  it("scripts/rehearse-release.mjs besteht mit den Testschlüsseln und weist die Manipulation ab", () => {
    const result = run("rehearse-release.mjs", []);
    assert.equal(result.ok, true, result.output);
    assert.match(result.output, /zusätzliche Datei wird abgewiesen \(Code 15\)/);
  });

  it("scripts/verify-tree.mjs: Liste ↔ Verzeichnis mit Exit-Codes des Prüfers", () => {
    const dir = bundleDir("verify-tree");
    run("gen-tree.mjs", [dir]);
    assert.equal(run("verify-tree.mjs", [dir]).ok, true);
    writeFileSync(path.join(dir, "zusaetzlich"), "x");
    const extra = spawnSync(process.execPath, ["--no-warnings", path.join("scripts", "verify-tree.mjs"), dir], { cwd: repo, encoding: "utf8" });
    assert.equal(extra.status, 15);
    assert.match(extra.stdout, /"reason":"extra"/);
  });
});
