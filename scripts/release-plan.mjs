// Release-Plan (Job "plan"): Entscheidet, ob dieser Lauf ein Release ist – ohne dass jemand einen Tag setzen muss.
//
//   Push auf main      → Release, wenn die Version in package.json noch keinen Tag hat (v<Version>). Das Hochsetzen der Version ist der Auslöser; solange sie
//                        einem vorhandenen Tag entspricht, ist der Lauf ein gewöhnlicher Lauf (alle Prüfungen, Image als edge/sha, kein Release).
//   Push eines Tags    → Release für genau diesen Tag (Handarbeit bleibt möglich; der Tag muss zu package.json passen).
//   alles andere       → kein Release (Pull Requests, "Run workflow").
//
//   node scripts/release-plan.mjs [--event push] [--ref refs/heads/main] [--version 1.2.3] [--tags "v0.1.0 v1.2.3"]
//   (ohne Angaben: GITHUB_EVENT_NAME, GITHUB_REF, package.json und `git tag -l 'v*'`.) Schreibt release/tag/version nach $GITHUB_OUTPUT und ins Protokoll.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planRelease } from "./lib/release-plan.mjs";

const args = process.argv.slice(2);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = valueOf("--version") ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tags = (valueOf("--tags") ?? execFileSync("git", ["tag", "-l", "v*"], { cwd: root, encoding: "utf8" })).split(/\s+/).filter(Boolean);
const plan = planRelease({ event: valueOf("--event") ?? process.env.GITHUB_EVENT_NAME ?? "", ref: valueOf("--ref") ?? process.env.GITHUB_REF ?? "", version, tags });

console.log(`${plan.release ? "RELEASE" : "kein Release"}: ${plan.reason}`);
if (plan.error) {
  console.error(`::error::${plan.error}`);
  process.exit(1);
}
const lines = `release=${plan.release}\ntag=${plan.tag}\nversion=${plan.version}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
else console.log(lines);
