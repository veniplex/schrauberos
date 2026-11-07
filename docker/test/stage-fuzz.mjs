// Stufe „fuzz“: libFuzzer-Ziele (clang) für den Siegel-Parser, den Listen-Parser und den Verzeichnislauf (strukturierte Bäume mit Orakel), jeweils mit AddressSanitizer
// und UndefinedBehaviorSanitizer. Kurzläufe (--fuzz-seconds N, Standard 10 s je Ziel; für den Abschluss 60 s und mehr), Eingabekorpus unter docker/test/build/fuzz-corpus.
// Saaten: die Siegel und Listen des Goldkorpus. Ein Fund (Absturz, Zeitüberschreitung, verletztes Orakel) ist ein Fehler; der Eingabeartefakt bleibt unter build/fuzz-artifacts.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { materializeCorpusCase } from "../../src/lib/updates/testdata/anchor/corpus-fs.ts";
import { buildDir, removeTree, repo, run, tempDir, vendorDir } from "./lib.mjs";
import { corpus } from "./stage-corpus.mjs";

const clang = () => {
  const r = run(process.env.CLANG ?? "clang", ["--version"]);
  return r.status === 0 ? process.env.CLANG ?? "clang" : null;
};

const SEAL_DICT = ['"schrauberos-seal 1\\x0a"', '"version "', '"base "', '"arch "', '"tree-sha512 "', '"tree-size "', '"tree-entries "', '"tree-bytes "', '"signing-key "', '"signature "', '"endorsement "', '"endorsement-sig "', '"schrauberos-endorsement 2\\x0a"', '"key "', '"valid-until "', '"x64"', '"0.3.0"', '"2026-11-07"'];
const TREE_DICT = ['"schrauberos-tree 1\\x0ahash sha512\\x0a"', '"d\\x09-\\x090\\x09-\\x09"', '"f\\x09-\\x09"', '"f\\x09x\\x09"', '"l\\x09-\\x090\\x09"', '"\\x09"', '"\\x0a"', '"../"', '"a/b"', '"node_modules"', '"SOS-TREE"', '"SOS-SEAL"', '"1099511627776"', '"\\xef\\xbf\\xbd"'];

export function fuzzStage(log, { fuzzSeconds }) {
  const cc = clang();
  if (!cc) {
    log("clang fehlt – libFuzzer-Ziele können nicht gebaut werden.");
    return process.env.REQUIRE_NATIVE !== "1";
  }
  const out = join(buildDir, "fuzz");
  mkdirSync(out, { recursive: true });
  const sanitize = ["-fsanitize=fuzzer,address,undefined", "-fno-sanitize-recover=undefined", "-O1", "-g", "-fno-omit-frame-pointer", "-std=gnu11", "-D_FILE_OFFSET_BITS=64"];
  const includes = [`-I${vendorDir}`, `-I${join(repo, "docker")}`];

  // Saaten aus dem Goldkorpus
  const seeds = { seal: join(out, "seed-seal"), tree: join(out, "seed-tree"), walk: join(out, "seed-walk") };
  for (const dir of Object.values(seeds)) mkdirSync(dir, { recursive: true });
  const dataDir = tempDir("so-fuzz-seed-");
  try {
    let n = 0;
    for (const name of ["valid", "valid-endorsed", "valid-endorsement-expired-not-checked", "seal-endorsement-expired", "tree-replaced", "seal-wrong-key"]) {
      const c = corpus.cases.find((x) => x.name === name);
      const dir = join(dataDir, `c${n++}`);
      mkdirSync(dir);
      materializeCorpusCase(c, dir);
      const version = join(dir, "app", "versions", c.args.version);
      const seal = readFileSync(join(version, "SOS-SEAL"));
      writeFileSync(join(seeds.seal, `${name}-a`), Buffer.concat([Buffer.from([1]), seal]));
      writeFileSync(join(seeds.seal, `${name}-b`), Buffer.concat([Buffer.from([0]), seal]));
      writeFileSync(join(seeds.tree, name), readFileSync(join(version, "SOS-TREE")));
    }
    for (const c of corpus.cases.filter((x) => x.name.startsWith("tree-"))) {
      const dir = join(dataDir, `t${n++}`);
      mkdirSync(dir);
      materializeCorpusCase(c, dir);
      const file = join(dir, "app", "versions", c.args.version, "SOS-TREE");
      if (existsSync(file)) writeFileSync(join(seeds.tree, c.name), readFileSync(file));
    }
  } finally {
    removeTree(dataDir);
  }
  for (let i = 0; i < 40; i++) writeFileSync(join(seeds.walk, `s${i}`), Buffer.from([...Array(24)].map((_, k) => (i * 37 + k * 11 + (k % 3) * 5) & 0xff)));
  writeFileSync(join(out, "seal.dict"), SEAL_DICT.map((t, i) => `t${i}=${t}`).join("\n") + "\n");
  writeFileSync(join(out, "tree.dict"), TREE_DICT.map((t, i) => `t${i}=${t}`).join("\n") + "\n");

  const targets = [
    { name: "fuzz-seal", defs: ["-DSOS_FUZZ_NO_SIGNATURE"], maxLen: 12000, dict: "seal.dict", seed: seeds.seal },
    { name: "fuzz-tree", defs: [], maxLen: 60000, dict: "tree.dict", seed: seeds.tree },
    { name: "fuzz-walk", defs: [], maxLen: 220, dict: null, seed: seeds.walk },
  ];
  let ok = true;
  for (const t of targets) {
    const bin = join(out, t.name);
    const build = run(cc, [...sanitize, ...includes, ...t.defs, "-o", bin, join(repo, "docker/test", `${t.name}.c`), join(repo, "docker/verify.c"), join(vendorDir, "monocypher.c"), join(vendorDir, "monocypher-ed25519.c")]);
    if (build.status !== 0) {
      log(`${t.name}: Übersetzen fehlgeschlagen\n${build.stderr}`);
      ok = false;
      continue;
    }
    const corpusDir = join(buildDir, "fuzz-corpus", t.name);
    mkdirSync(corpusDir, { recursive: true });
    const artifacts = join(buildDir, "fuzz-artifacts") + "/";
    mkdirSync(artifacts, { recursive: true });
    const args = [corpusDir, t.seed, `-max_total_time=${fuzzSeconds}`, "-timeout=10", "-rss_limit_mb=3072", `-max_len=${t.maxLen}`, `-artifact_prefix=${artifacts}${t.name}-`, "-print_final_stats=1", "-detect_leaks=1"];
    if (t.dict) args.push(`-dict=${join(out, t.dict)}`);
    const started = Date.now();
    const r = run(bin, args, { env: { ...process.env, ASAN_OPTIONS: "detect_leaks=1", TMPDIR: "/tmp" } });
    const text = `${r.stderr}\n${r.stdout}`;
    const stat = (name) => new RegExp(`stat::${name}:\\s+(\\d+)`).exec(text)?.[1];
    const units = stat("number_of_executed_units");
    const cov = /cov: (\d+) ft: (\d+)/g;
    let last;
    for (const m of text.matchAll(cov)) last = m;
    const found = r.status !== 0;
    log(`${t.name}: ${found ? "FUND" : "ohne Fund"} – ${units ?? "?"} Ausführungen in ${((Date.now() - started) / 1000).toFixed(0)} s, Abdeckung ${last?.[1] ?? "?"} Kanten / ${last?.[2] ?? "?"} Merkmale, Korpus ${readdirSync(corpusDir).length} Dateien`);
    if (found) {
      ok = false;
      log(text.split("\n").filter((l) => /ERROR|SUMMARY|#\d+|Test unit|artifact|Orakel|runtime error/.test(l)).slice(0, 25).join("\n"));
    }
  }
  return ok;
}
