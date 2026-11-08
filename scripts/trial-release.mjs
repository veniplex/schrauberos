// Baut für Probeläufe der Update-Kette ein TESTRELEASE (nur lokal, nur mit Testschlüsseln) – mit denselben Skripten wie die Pipeline (gen-tree, make-seal, make-release):
//   node scripts/trial-release.mjs --from <entpacktes-paket> --version <x.y.z> --out <releaseordner> [--mutate crash|unhealthy|exit42|none] [--key-file <release-key.ts>]
//                                  [--base N] [--arch a] [--chain]
// `--from`: ein Paketverzeichnis (zum Beispiel `docker cp <container>:/app/. dir` aus einem Image, das die Testschlüssel trägt: Dockerfile-Ziel runner-test, gebaut aus einem
// Kontext, in dem src/modules/admin/updates/release-key.ts die Testschlüssel enthält – README „Starter-Vertrauensanker“, Abschnitt Probeläufe). Daraus entsteht
// `<out>/schrauberos-<version>.tar.gz` samt SOS-SEAL, manifest.json und manifest.json.sig, bereit für scripts/trial-mirror.mjs.
//   --mutate crash      server.js beendet sich sofort (Launcher: Rückfall auf die Vorversion)
//   --mutate unhealthy  server.js lauscht, antwortet aber auf /api/health nie mit „ok“ (503 error): Gesundheitsfrist läuft ab → Rückfall
//   --mutate exit42     server.js verlangt sofort einen Neustart (Exit-Code 42): jede Runde geht über den Starter
//   --post <modus>      verändert das fertige Release absichtlich (Negativproben der App beim Installieren):
//                         rogue-manifest  Manifest-Signatur stammt von einem unbekannten Schlüssel (TEST_ROGUE)
//                         bad-sha         ein Byte des Pakets ist nach dem Signieren verändert (SHA-256 aus dem Manifest passt nicht)
//                         seal-swap       SOS-SEAL stammt aus einem anderen Release (--seal-from <releaseordner>)
//   --endorse-until <JJJJ-MM-TT> [--sign-now <JJJJ-MM-TT>]   Ablauf der Beglaubigung (mit --chain); --sign-now lässt make-seal so rechnen, als wäre heute dieses Datum
//                       (SOS_NOW, nur für Tests): so entsteht ein Siegel mit inzwischen abgelaufener Beglaubigung (Der Starter prüft den Ablauf nie, die App beim Installieren)
//   --seal-chain        nur das SIEGEL trägt die Beglaubigung (TEST_SECOND), das Manifest ist mit dem eingebauten Release-Schlüssel signiert – mit --endorse-until/--sign-now ein
//                       Siegel mit abgelaufener Beglaubigung, ohne dass schon die Manifest-Prüfung der App den Schlüssel verwirft
//   --chain             signiert mit einem vom Wurzelschlüssel BEGLAUBIGTEN zweiten Release-Schlüssel (Schlüsselkette; Testschlüssel TEST_SECOND) statt mit dem eingebauten
// Schlüssel: nur `src/lib/updates/testdata/anchor/test-keys.ts`, nie ein echter Schlüssel (das Skript bricht ab, wenn es nicht die Testschlüssel-Datei nutzt).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sign } from "node:crypto";
import { createEndorsement, manifestSignedBytes } from "../src/lib/updates/keychain.ts";
import { TEST_RELEASE, TEST_ROGUE, TEST_ROOT, TEST_SECOND } from "../src/lib/updates/testdata/anchor/test-keys.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const from = resolve(arg("--from", ""));
const version = arg("--version");
const out = resolve(arg("--out", ""));
const mutate = arg("--mutate", "none");
const keyFile = arg("--key-file");
if (!arg("--from") || !arg("--out") || !/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Aufruf: node scripts/trial-release.mjs --from <paket> --version x.y.z --out <ordner> [--mutate crash|unhealthy|exit42|none] [--key-file <ts>] [--chain]");
if (!keyFile) throw new Error("--key-file fehlt: die Datei mit den TESTSCHLÜSSELN (export const RELEASE_PUBLIC_KEY/ROOT_PUBLIC_KEY), mit der auch das Image gebaut wurde.");
const keySource = readFileSync(resolve(keyFile), "utf8");
if (!keySource.includes(TEST_RELEASE.publicPem.trim()) || !keySource.includes(TEST_ROOT.publicPem.trim())) throw new Error("Die Schlüsseldatei enthält nicht die Testschlüssel – Abbruch (dieses Skript signiert nie mit echten Schlüsseln).");

const bundle = join(out, ".bundle");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(from, bundle, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
rmSync(join(bundle, "SOS-TREE"), { force: true });
rmSync(join(bundle, "SOS-SEAL"), { force: true });

const meta = JSON.parse(readFileSync(join(bundle, "version.json"), "utf8"));
meta.version = version;
if (arg("--base")) meta.base = Number(arg("--base"));
if (arg("--arch")) meta.arch = arg("--arch");
writeFileSync(join(bundle, "version.json"), JSON.stringify(meta, null, 2) + "\n");

const server = join(bundle, "server.js");
const header = `// Probe-Release ${version}: ${mutate}\n`;
if (mutate === "crash") writeFileSync(server, `${header}console.error("[probe] absichtlich defekte Version ${version}");\nprocess.exit(1);\n`);
else if (mutate === "unhealthy")
  writeFileSync(server, `${header}require("node:http").createServer((req, res) => { res.writeHead(503, { "content-type": "application/json" }); res.end('{"status":"error"}'); }).listen(Number(process.env.PORT || 3000), process.env.HOSTNAME || "0.0.0.0", () => console.error("[probe] absichtlich nie gesunde Version ${version}"));\n`);
else if (mutate === "exit42") writeFileSync(server, `${header}console.error("[probe] verlangt Neustart");\nprocess.exit(42);\n`);
else if (mutate !== "none") throw new Error(`Unbekannte Mutation: ${mutate}`);
// Der Besitzer-/Modus-Zustand bleibt (cpSync erhält Modi); server.js wird normal beschrieben
const run = (script, scriptArgs, env = {}) => {
  const r = spawnSync(process.execPath, ["--no-warnings", join(repo, "scripts", script), ...scriptArgs], { cwd: repo, encoding: "utf8", env: { ...process.env, RELEASE_KEY_FILE: resolve(keyFile), ...env } });
  if (r.status !== 0) throw new Error(`${script} fehlgeschlagen:\n${r.stderr}${r.stdout}`);
  return r.stdout.trim();
};

let signing = TEST_RELEASE;
const sealEnv = {};
const sealChain = args.includes("--seal-chain");
if (args.includes("--chain") || sealChain) {
  // Schlüsselkette: Der Wurzelschlüssel (TEST_ROOT) beglaubigt TEST_SECOND; das Siegel trägt die Beglaubigung. Die Datei release-keys.json liefert das Release mit.
  const validUntil = arg("--endorse-until") ?? new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const endorsement = createEndorsement(TEST_ROOT.privatePem, TEST_SECOND.publicPem, validUntil);
  writeFileSync(join(out, "release-keys.json"), JSON.stringify({ keys: [endorsement] }, null, 2) + "\n");
  sealEnv.RELEASE_KEYS_FILE = join(out, "release-keys.json");
  signing = TEST_SECOND;
}
const manifestEnv = { RELEASE_SIGNING_KEY: sealChain ? TEST_RELEASE.privatePem : signing.privatePem, ...(sealChain ? {} : sealEnv) };
if (arg("--sign-now")) sealEnv.SOS_NOW = arg("--sign-now");
const env = { RELEASE_SIGNING_KEY: signing.privatePem, ...sealEnv };

console.log(run("gen-tree.mjs", [bundle]));
console.log(run("make-seal.mjs", ["--bundle", bundle, "--out", out], env));
const archive = join(out, `schrauberos-${version}.tar.gz`);
const tar = spawnSync("tar", ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", "-czf", archive, "-C", bundle, "."], { encoding: "utf8" });
if (tar.status !== 0) throw new Error(`tar fehlgeschlagen: ${tar.stderr}`);
console.log(run("make-release.mjs", ["--archive", archive, "--bundle", bundle, "--out", out], manifestEnv));
rmSync(bundle, { recursive: true, force: true });
const post = arg("--post");
if (post === "rogue-manifest") {
  const manifest = readFileSync(join(out, "manifest.json"));
  writeFileSync(join(out, "manifest.json.sig"), sign(null, manifestSignedBytes(manifest), TEST_ROGUE.privatePem));
} else if (post === "bad-sha") {
  const bytes = readFileSync(archive);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  writeFileSync(archive, bytes);
} else if (post === "seal-swap") {
  if (!arg("--seal-from")) throw new Error("--post seal-swap braucht --seal-from <releaseordner>");
  writeFileSync(join(out, "SOS-SEAL"), readFileSync(join(resolve(arg("--seal-from")), "SOS-SEAL")));
} else if (post) throw new Error(`Unbekannter --post-Modus: ${post}`);
if (!existsSync(join(out, "SOS-SEAL")) || !existsSync(join(out, "manifest.json.sig"))) throw new Error("Release unvollständig (SOS-SEAL oder manifest.json.sig fehlt).");
console.log(`Testrelease ${version} (${mutate}${signing === TEST_SECOND ? ", beglaubigter Schlüssel" : ""}${post ? `, ${post}` : ""}) in ${out}`);
