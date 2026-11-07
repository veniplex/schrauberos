// Macht aus einem entpackten App-Verzeichnis (z. B. `docker cp <container>:/app/. dir`) ein installierbares TESTPAKET: setzt die Version, erzeugt die Dateiliste neu und siegelt
// sie mit dem TESTSCHLÜSSEL (src/lib/updates/testdata/anchor/test-keys.ts). Nur für scripts/smoke-anchor.sh gegen ein Image mit Testschlüsseln (Dockerfile-Ziel runner-test).
//   node docker/test/make-test-package.mjs <verzeichnis> --version <x.y.z> [--base N] [--arch a] [--seal-version <x.y.z>]
// --seal-version: die Version im Siegel weicht absichtlich vom Ordnernamen ab (Umetikettieren).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSeal, sealFieldsFor } from "../../src/lib/updates/seal.ts";
import { generateTree, nodeFs, serializeTree } from "../../src/lib/updates/tree.ts";
import { TEST_RELEASE } from "../../src/lib/updates/testdata/anchor/test-keys.ts";

const args = process.argv.slice(2);
const dir = resolve(args[0] ?? "");
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const version = arg("--version");
if (!args[0] || !/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Aufruf: make-test-package.mjs <verzeichnis> --version x.y.z");

const meta = JSON.parse(readFileSync(resolve(dir, "version.json"), "utf8"));
meta.version = version;
if (arg("--base")) meta.base = Number(arg("--base"));
if (arg("--arch")) meta.arch = arg("--arch");
writeFileSync(resolve(dir, "version.json"), JSON.stringify(meta));
rmSync(resolve(dir, "SOS-TREE"), { force: true });
rmSync(resolve(dir, "SOS-SEAL"), { force: true });
const tree = serializeTree(await generateTree(nodeFs(dir)));
writeFileSync(resolve(dir, "SOS-TREE"), tree);
const sealed = { version: arg("--seal-version", version), base: meta.base, arch: meta.arch ?? "x64" };
writeFileSync(resolve(dir, "SOS-SEAL"), createSeal(sealFieldsFor(tree, sealed), TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }));
console.log(`Testpaket ${version} (base ${meta.base}, ${meta.arch ?? "?"}) in ${dir}: Liste ${tree.length} Bytes.`);
