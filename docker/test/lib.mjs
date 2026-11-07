// Gemeinsame Hilfen der nativen Tests des Starters (docker/test/run.mjs): Übersetzen mit gcc/clang, Header der Vertrauensanker mit Testschlüsseln, Pakete bauen.
// Nur Linux (Dateimodi, Symlinks, FIFOs); unter Windows startet run.mjs alles in WSL.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSeal, sealFieldsFor } from "../../src/lib/updates/seal.ts";
import { generateTree, nodeFs, serializeTree } from "../../src/lib/updates/tree.ts";
import { TEST_RELEASE } from "../../src/lib/updates/testdata/anchor/test-keys.ts";

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const buildDir = join(repo, "docker/test/build");
export const vendorDir = join(repo, "docker/vendor/monocypher");

const detect = () => {
  for (const cc of [process.env.CC, "gcc", "clang"]) {
    if (!cc) continue;
    const r = spawnSync(cc, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return { cc, version: r.stdout.split("\n")[0] };
  }
  return null;
};
export const compiler = detect();

/** Flags der Produktion (Dockerfile): gleiche Warnungen und Härtung wie im Image; die vendorte Bibliothek wird separat und ohne -Wconversion übersetzt. */
export const STRICT = ["-std=gnu11", "-O2", "-Wall", "-Wextra", "-Wformat=2", "-Wconversion", "-Wshadow", "-Werror", "-D_FILE_OFFSET_BITS=64", "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2", "-fPIE"];
export const LINK_STATIC = ["-static-pie", "-Wl,-z,relro,-z,now"];
export const SANITIZE = ["-std=gnu11", "-O1", "-g", "-fno-omit-frame-pointer", "-fsanitize=address,undefined", "-fno-sanitize-recover=undefined", "-Wall", "-Wextra", "-Werror", "-D_FILE_OFFSET_BITS=64"];

export function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

export function compile(output, sources, flags, { cwd = repo } = {}) {
  mkdirSync(dirname(output), { recursive: true });
  const r = run(compiler.cc, [...flags, "-o", output, ...sources], { cwd });
  if (r.status !== 0) throw new Error(`Übersetzen von ${output} fehlgeschlagen:\n${r.stderr}${r.stdout}`);
  return output;
}

const builtVendor = new Set();

/** Vendorte Monocypher-Objekte (einmal je Flag-Satz und Lauf). */
export function vendorObjects(tag, flags) {
  const out = [];
  for (const name of ["monocypher", "monocypher-ed25519"]) {
    const obj = join(buildDir, `vendor-${tag}-${name}.o`);
    if (builtVendor.has(obj)) {
      out.push(obj);
      continue;
    }
    builtVendor.add(obj);
    const r = run(compiler.cc, [...flags, "-Wno-conversion", "-c", "-o", obj, join(vendorDir, `${name}.c`)]);
    if (r.status !== 0) throw new Error(`Monocypher ${name}: ${r.stderr}`);
    out.push(obj);
  }
  return out;
}

/** Header mit den Testschlüsseln und der Untergrenze `floor` (eingebaute Version); liefert das Verzeichnis für -I. */
export function headerDir(floor, { base } = {}) {
  const key = createHash("sha256").update(`${floor}/${base ?? ""}`).digest("hex").slice(0, 12);
  const dir = join(buildDir, `hdr-${key}`);
  if (!existsSync(join(dir, "trust-keys.h"))) {
    mkdirSync(dir, { recursive: true });
    const r = run(process.execPath, ["--no-warnings", join(repo, "docker/test/gen-test-header.mjs"), "--out", join(dir, "trust-keys.h"), "--version", floor, "--arch", "x64"], { cwd: repo });
    if (r.status !== 0) throw new Error(`gen-test-header: ${r.stderr}`);
  }
  return dir;
}

/** Das Prüf-/Starterbinary mit Testschlüsseln und gegebener Untergrenze (Produktionsflags, statisch). */
export function buildStarter(floor, { tag, extraDefs = [], sanitize = process.env.SOS_SANITIZE === "1", name, production = false } = {}) {
  tag ??= sanitize ? "asan" : "prod";
  const hdr = headerDir(floor);
  const flags = sanitize ? SANITIZE : STRICT;
  const out = join(buildDir, `${name ?? "bootstrap"}-${tag}-${createHash("sha256").update(floor + extraDefs.join(" ")).digest("hex").slice(0, 8)}`);
  const objs = vendorObjects(sanitize ? "san" : "prod", sanitize ? ["-O1", "-g", "-fsanitize=address,undefined", "-fno-sanitize-recover=undefined", "-w"] : ["-O2", "-fPIE", "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2", "-Wall", "-Wextra"]);
  compile(
    out,
    [join(repo, "docker/bootstrap.c"), join(repo, "docker/verify.c"), ...objs],
    [...flags, ...(sanitize ? [] : LINK_STATIC), `-I${hdr}`, `-I${join(repo, "docker")}`, `-I${vendorDir}`, ...(production ? ["-DSOS_PRODUCTION=1"] : []), ...extraDefs],
  );
  return out;
}

export const tempDir = (prefix = "so-native-") => mkdtempSync(join(tmpdir(), prefix));

export function removeTree(dir) {
  run("chmod", ["-R", "u+rwX", dir]);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Baut ein echtes Paketverzeichnis `<dataDir>/app/versions/<version>` mit Dateiliste und Siegel (Testschlüssel). `files`: zusätzliche Dateien {pfad: inhalt|{content, mode}}.
 * `runtime/node` ist das übergebene Programm (die Attrappe), `launcher.mjs` die Anweisung für sie.
 */
export async function makePackage(dataDir, version, { launcherBinary, script = "exit 0\n", files = {}, sparse = {}, base = 4, arch = "x64", signer = TEST_RELEASE, dir } = {}) {
  const target = dir ?? join(dataDir, "app", "versions", version);
  mkdirSync(join(target, "runtime"), { recursive: true });
  if (launcherBinary) {
    copyFileSync(launcherBinary, join(target, "runtime", "node"));
    chmodSync(join(target, "runtime", "node"), 0o755);
  }
  writeFileSync(join(target, "launcher.mjs"), script);
  writeFileSync(join(target, "version.json"), JSON.stringify({ version, base, arch }) + "\n");
  for (const [path, spec] of Object.entries(files)) {
    const full = join(target, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    const { content, mode } = typeof spec === "string" || Buffer.isBuffer(spec) ? { content: spec, mode: 0o644 } : spec;
    writeFileSync(full, content);
    chmodSync(full, mode);
  }
  for (const [path, size] of Object.entries(sparse)) {
    const full = join(target, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    const fd = openSync(full, "w");
    ftruncateSync(fd, size);
    closeSync(fd);
  }
  const tree = serializeTree(await generateTree(nodeFs(target)));
  writeFileSync(join(target, "SOS-TREE"), tree);
  writeFileSync(join(target, "SOS-SEAL"), createSeal(sealFieldsFor(tree, { version, base, arch }), signer.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }));
  return target;
}

export function activate(dataDir, version) {
  mkdirSync(join(dataDir, "app"), { recursive: true });
  writeFileSync(join(dataDir, "app", "active"), join(dataDir, "app", "versions", version));
}

export { execFileSync, readFileSync };
