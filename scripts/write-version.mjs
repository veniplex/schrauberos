// Schreibt version.json (Version, Image-Unterbau, Node-Version) in ein Verzeichnis.
// Wird beim Docker-Build für das Image und für das Release-Paket verwendet:
//   node scripts/write-version.mjs --out <verzeichnis> [--version 1.2.3]
// Ohne Angabe: APP_VERSION aus der Umgebung, sonst "<package.json-Version>-dev".
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = arg("--version") || process.env.APP_VERSION || `${pkg.version}-dev`;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Ungültige Version: ${version}`);

const base = Number(readFileSync(resolve(root, "docker/BASE_VERSION"), "utf8").trim());
if (!Number.isInteger(base) || base < 1) throw new Error("docker/BASE_VERSION muss eine ganze Zahl >= 1 enthalten.");

// Commit nur zur Anzeige (Systemstatus): --commit, sonst APP_COMMIT aus dem Build, sonst nichts (lokaler Build)
const rawCommit = arg("--commit") || process.env.APP_COMMIT || "";
const commit = /^[0-9a-f]{7,40}$/i.test(rawCommit) ? rawCommit.slice(0, 7).toLowerCase() : undefined;

const out = resolve(root, arg("--out") ?? ".");
writeFileSync(resolve(out, "version.json"), JSON.stringify({ version, base, node: process.version, arch: process.arch, ...(commit ? { commit } : {}) }, null, 2) + "\n");
console.log(`version.json: ${version} (base ${base}, node ${process.version}${commit ? `, commit ${commit}` : ""})`);
