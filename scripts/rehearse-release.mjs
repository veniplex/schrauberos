// Generalprobe der Signierstrecke OHNE Produktionsschlüssel: baut ein kleines Beispielpaket, erzeugt Dateiliste, Siegel und Manifest mit den **Testschlüsseln**
// (src/lib/updates/testdata/anchor/test-keys.ts) und prüft das Ergebnis mit dem Referenzprüfer – einmal gültig, einmal manipuliert. Kein Secret, keine Veröffentlichung.
//   node scripts/rehearse-release.mjs
// Die Echtprobe gegen das Produktions-Image mit den echten Schlüsseln macht der Job „release“ (scripts/real-trial.sh).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_RELEASE, TEST_ROOT } from "../src/lib/updates/testdata/anchor/test-keys.ts";

const repo = resolve(fileURLToPath(import.meta.url), "../..");
const work = mkdtempSync(join(tmpdir(), "so-rehearsal-"));

function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, ["--no-warnings", join(repo, "scripts", script), ...args], { cwd: repo, env: { ...process.env, ...env }, encoding: "utf8" });
  return { status: r.status, output: `${r.stderr}${r.stdout}` };
}
function must(result, what) {
  if (result.status !== 0) {
    console.error(`${what} fehlgeschlagen:\n${result.output}`);
    process.exit(1);
  }
  console.log(`ok: ${what}`);
}

try {
  const keyFile = join(work, "release-key.ts");
  writeFileSync(keyFile, `export const RELEASE_PUBLIC_KEY = \`${TEST_RELEASE.publicPem}\`;\nexport const ROOT_PUBLIC_KEY = \`${TEST_ROOT.publicPem}\`;\n`);
  const env = { RELEASE_KEY_FILE: keyFile, RELEASE_SIGNING_KEY: TEST_RELEASE.privatePem, RELEASE_KEYS_FILE: join(work, "keine.json") };

  const bundle = join(work, "bundle");
  mkdirSync(join(bundle, "runtime", "lib"), { recursive: true });
  writeFileSync(join(bundle, "version.json"), JSON.stringify({ version: "9.9.9", base: 4, arch: "x64" }));
  writeFileSync(join(bundle, "server.js"), "// beispiel\n");
  writeFileSync(join(bundle, "runtime", "node"), "node", { mode: 0o755 });
  writeFileSync(join(bundle, "runtime", "lib", "libx.so"), "lib");
  const out = join(work, "release");
  mkdirSync(out);
  writeFileSync(join(out, "paket.tar.gz"), "inhalt");

  must(run("gen-tree.mjs", [bundle]), "Dateiliste erzeugen");
  must(run("make-seal.mjs", ["--bundle", bundle, "--out", out], env), "Siegel signieren");
  must(run("make-release.mjs", ["--archive", join(out, "paket.tar.gz"), "--bundle", bundle, "--out", out], env), "Manifest signieren");
  const verify = (extra = []) => run("verify-tree.mjs", [bundle, "--seal", join(out, "SOS-SEAL"), "--expect-version", "9.9.9", "--no-floor", ...extra], env);
  must(verify(), "Siegel, Liste und Baum prüfen");

  writeFileSync(join(bundle, "zusaetzlich.txt"), "x");
  const tampered = verify();
  if (tampered.status !== 15) {
    console.error(`Eine zusätzliche Datei hätte mit Code 15 abgewiesen werden müssen, war ${tampered.status}:\n${tampered.output}`);
    process.exit(1);
  }
  console.log("ok: zusätzliche Datei wird abgewiesen (Code 15)");
  console.log(`Generalprobe bestanden (Testschlüssel; Manifest ${readFileSync(join(out, "manifest.json")).length} Bytes).`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
