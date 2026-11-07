// Erzeugt den Header der Vertrauensanker mit den TESTSCHLÜSSELN (src/lib/updates/testdata/anchor/test-keys.ts) statt der echten – für Testbinaries des Starters
// (docker/test/run.mjs) und das Dockerfile-Ziel "runner-test". Ruft scripts/gen-trust-header.mjs mit einer erzeugten Schlüsseldatei auf.
//   node docker/test/gen-test-header.mjs --out <trust-keys.h> [--version <eingebaute Version>] [--arch x64]
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_RELEASE, TEST_ROOT } from "../../src/lib/updates/testdata/anchor/test-keys.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), "so-test-keys-"));
try {
  const keyFile = join(dir, "release-key.ts");
  writeFileSync(keyFile, `export const RELEASE_PUBLIC_KEY = \`${TEST_RELEASE.publicPem}\`;\nexport const ROOT_PUBLIC_KEY = \`${TEST_ROOT.publicPem}\`;\n`);
  const r = spawnSync(process.execPath, ["--no-warnings", join(repo, "scripts/gen-trust-header.mjs"), ...args, "--release-key-file", keyFile], { stdio: "inherit", env: { ...process.env, SOS_TAG_BUILD: "0" } });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
