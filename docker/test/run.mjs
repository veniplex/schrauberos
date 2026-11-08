#!/usr/bin/env node
// Native Tests des Starter-Vertrauensankers (Stufe L2, README „Starter-Vertrauensanker“, Abschnitt Tests):
//   node docker/test/run.mjs [stufe …] [--fuzz-seconds N]        Stufen: crypto corpus mutation parser asan starter pidns fuzz  (Standard: alle außer fuzz)
// Läuft unter Linux mit gcc oder clang und Node >= 24. Unter Windows werden Repository und Lauf in WSL (Standarddistribution) gespiegelt. Ohne Compiler: Fehler, wenn
// REQUIRE_NATIVE=1 (CI), sonst Hinweis und Ende ohne Fehler.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (process.platform === "win32") {
  const wslPath = spawnSync("wsl", ["wslpath", "-a", resolve(here, "../..").replaceAll("\\", "/")], { encoding: "utf8" }); // Schrägstriche: wsl.exe reicht Rückstriche an die Shell durch, die sie verschluckt
  if (wslPath.status !== 0) {
    console.error("Kein WSL gefunden: die nativen Tests brauchen Linux (gcc/clang). Siehe README, Abschnitt Tests.");
    process.exit(process.env.REQUIRE_NATIVE === "1" ? 1 : 0);
  }
  const quoted = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const script =
    `set -e; mkdir -p ~/sos-build; rsync -a --delete --exclude node_modules --exclude .next --exclude .git --exclude test-results --exclude '*.db*' ` +
    `--exclude docker/test/build '${wslPath.stdout.trim()}/' ~/sos-build/; cd ~/sos-build; NODE="$(command -v node || echo $HOME/node/bin/node)"; "$NODE" --no-warnings docker/test/run.mjs ${quoted}`;
  const r = spawnSync("wsl", ["-e", "bash", "-lc", script], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const { compiler } = await import("./lib.mjs");
if (!compiler) {
  console.error("Kein C-Compiler (gcc/clang) gefunden – die nativen Tests des Starters laufen nicht.");
  process.exit(process.env.REQUIRE_NATIVE === "1" ? 1 : 0);
}

const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--fuzz-seconds");
const all = ["crypto", "corpus", "mutation", "parser", "asan", "starter", "pidns"];
const stages = wanted.length ? wanted : all;
const fuzzSeconds = Number(flag("--fuzz-seconds", "10"));

const log = (message) => console.log(message);
console.log(`Compiler: ${compiler.version}; Node ${process.version}`);
let failed = 0;
for (const stage of stages) {
  console.log(`\n== ${stage} ==`);
  const started = Date.now();
  let ok;
  try {
    const stageModule = await import(`./stage-${stage}.mjs`);
    ok = await stageModule[`${stage}Stage`](log, { fuzzSeconds });
  } catch (error) {
    console.error(error);
    ok = false;
  }
  console.log(`${ok ? "OK" : "FEHLER"}: ${stage} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (!ok) failed++;
}
console.log(failed ? `\n${failed} Stufe(n) fehlgeschlagen.` : "\nAlle Stufen bestanden.");
process.exit(failed ? 1 : 0);
