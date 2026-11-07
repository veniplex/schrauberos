// Stufe „corpus“: der Goldkorpus (src/lib/updates/testdata/anchor/cases.json) gegen den C-Prüfer. Jeder Fall wird als echtes Verzeichnis angelegt (Ausführbit, Setuid,
// Symlinks, FIFOs) und mit `bootstrap --verify` geprüft; verlangt werden (1) das im Korpus festgelegte Urteil (Exit-Code, Grund, Pfad) und (2) Gleichheit mit dem
// TypeScript-Referenzprüfer auf demselben Verzeichnis (Exit-Code, Grund, Pfad).
import { readFileSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { pemToRawKey } from "../../src/lib/updates/keychain.ts";
import { classifyVerifyExit, findNodeModulesAncestor, verifyVersion } from "../../src/lib/updates/seal.ts";
import { nodeFs } from "../../src/lib/updates/tree.ts";
import { materializeCorpusCase } from "../../src/lib/updates/testdata/anchor/corpus-fs.ts";
import { buildStarter, removeTree, repo, run, tempDir } from "./lib.mjs";

export const corpus = JSON.parse(readFileSync(join(repo, "src/lib/updates/testdata/anchor/cases.json"), "utf8"));
const trust = { releaseKey: pemToRawKey(corpus.trust.releasePublicPem), rootKey: pemToRawKey(corpus.trust.rootPublicPem) };

/** Argumente des Referenzprüfers für einen Fall (wie anchor-corpus.test.ts). */
export const referenceOptions = (c) => ({
  trust,
  expectVersion: c.args.version,
  image: c.args.image,
  floor: c.args.floor,
  enforceFloor: c.args.enforceFloor,
  checkExpiry: c.args.checkExpiry ? new Date(`${c.args.checkExpiry}T12:00:00Z`) : null,
});

/** Kommandozeile des C-Prüfers für einen Fall. */
export const cliArgs = (c, dataDir) => {
  const args = ["--verify", join(dataDir, "app", "versions", c.args.version), "--expect-version", c.args.version];
  if (c.args.enforceFloor === false) args.push("--no-floor");
  if (c.args.checkExpiry) args.push("--check-expiry", c.args.checkExpiry);
  return args;
};

export function parseJson(stdout) {
  const line = stdout.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** C-Prüfer und Referenzprüfer auf demselben Verzeichnis; liefert beide Urteile (Code, Grund, Pfad). */
export async function judgeBoth(binary, c, dataDir) {
  const versionDir = join(dataDir, "app", "versions", c.args.version);
  const result = run(binary, cliArgs(c, dataDir), { env: { PATH: process.env.PATH, DATA_DIR: dataDir } });
  const json = parseJson(result.stdout);
  const reference = await verifyVersion({
    ...referenceOptions(c),
    fs: nodeFs(versionDir),
    ancestorProbe: () => findNodeModulesAncestor(versionDir, dataDir, async (candidate) => lstat(candidate).then(() => true, () => false)),
  });
  return {
    c: { code: result.status, signal: result.signal, json, stderr: result.stderr },
    ref: { code: reference.ok ? 0 : reference.code, reason: reference.ok ? undefined : reference.reason, path: reference.ok ? undefined : reference.path, raw: reference },
  };
}

/** Beschreibt eine Abweichung zwischen C und Referenzprüfer (oder `null`, wenn beide gleich urteilen). */
export function disagreement(both) {
  const { c, ref } = both;
  if (!c.json) return `keine JSON-Zeile (Exit ${c.code}, Signal ${c.signal}) ${c.stderr.slice(0, 120)}`;
  if (c.code !== ref.code) return `C: ${c.code} ${c.json.reason}, Referenz: ${ref.code} ${ref.reason}`;
  if (ref.code !== 0 && c.json.reason !== ref.reason) return `Grund C: ${c.json.reason}, Referenz: ${ref.reason}`;
  if (ref.code !== 0 && ref.path !== undefined && ref.path !== "" && c.json.path !== sanitize(ref.path)) return `Pfad C: ${JSON.stringify(c.json.path)}, Referenz: ${JSON.stringify(ref.path)}`;
  return null;
}

export async function corpusStage(log) {
  const binaries = new Map();
  // SOS_STARTER_BINARY: ein anderweitig gebautes Binary (z. B. aus dem Dockerfile-Ziel bootstrap-test-build, Debian-Compiler) für Fälle mit der Untergrenze SOS_STARTER_FLOOR (Standard 0.2.0-dev.abc1234)
  const external = process.env.SOS_STARTER_BINARY;
  const externalFloor = process.env.SOS_STARTER_FLOOR ?? "0.2.0-dev.abc1234";
  const binaryFor = (floor) => {
    if (external && floor === externalFloor) return external;
    if (!binaries.has(floor)) binaries.set(floor, buildStarter(floor));
    return binaries.get(floor);
  };
  let failures = 0;
  const problems = [];
  const fail = (c, message) => {
    failures++;
    problems.push(`  ${c.name}: ${message}`);
  };
  for (const c of corpus.cases) {
    const dataDir = tempDir("so-corpus-c-");
    try {
      materializeCorpusCase(c, dataDir);
      const versionDir = join(dataDir, "app", "versions", c.args.version);
      const result = run(binaryFor(c.args.floor), cliArgs(c, dataDir), { env: { PATH: process.env.PATH, DATA_DIR: dataDir } });
      const json = parseJson(result.stdout);
      const code = result.status;
      const reference = await verifyVersion({
        ...referenceOptions(c),
        fs: nodeFs(versionDir),
        ancestorProbe: () => findNodeModulesAncestor(versionDir, dataDir, async (candidate) => lstat(candidate).then(() => true, () => false)),
      });
      const referenceCode = reference.ok ? 0 : reference.code;
      if (!json) {
        fail(c, `keine JSON-Zeile (Exit ${code}, Signal ${result.signal}): ${result.stderr.slice(0, 200)}`);
        continue;
      }
      if (code !== c.expect.code) fail(c, `Exit-Code ${code}, erwartet ${c.expect.code} (${JSON.stringify(json)})`);
      if (code !== referenceCode) fail(c, `Exit-Code ${code}, Referenzprüfer ${referenceCode} (${JSON.stringify(reference)})`);
      if (classifyVerifyExit(code) !== c.expect.class) fail(c, `Klasse ${classifyVerifyExit(code)}, erwartet ${c.expect.class}`);
      if (c.expect.reason && json.reason !== c.expect.reason) fail(c, `Grund ${json.reason}, erwartet ${c.expect.reason}`);
      if (c.expect.path && json.path !== c.expect.path) fail(c, `Pfad ${JSON.stringify(json.path)}, erwartet ${JSON.stringify(c.expect.path)}`);
      if (!reference.ok) {
        if (reference.reason !== json.reason) fail(c, `Grund ${json.reason}, Referenzprüfer ${reference.reason}`);
        if (reference.path !== undefined && reference.path !== "" && json.path !== sanitize(reference.path)) fail(c, `Pfad ${JSON.stringify(json.path)}, Referenzprüfer ${JSON.stringify(reference.path)}`);
      } else if (json.ok !== true || json.version !== c.args.version) {
        fail(c, `ok-Ausgabe unvollständig: ${JSON.stringify(json)}`);
      } else if (json.floor !== reference.floor || json.files !== reference.files || json.bytes !== reference.bytes) {
        fail(c, `ok-Ausgabe weicht ab: C ${JSON.stringify(json)} gegen ${JSON.stringify(reference)}`);
      }
    } finally {
      removeTree(dataDir);
    }
  }
  log(`${corpus.cases.length} Fälle des Goldkorpus, ${binaries.size} Binaries (Untergrenzen: ${[...binaries.keys()].join(", ")})`);
  if (problems.length) log(problems.join("\n"));
  return failures === 0;
}

/** Wie `sos_clean` im Prüfer: C0/C1-Steuerzeichen, Bidi-Steuerzeichen, Zeilentrenner und U+FFFD werden '?', Länge höchstens 200 Bytes. */
function sanitize(value) {
  let out = "";
  for (const ch of value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069\ufffd]/g, "?")) {
    if (Buffer.byteLength(out + ch) > 200) break;
    out += ch;
  }
  return out;
}
