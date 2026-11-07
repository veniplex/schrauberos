// Stufe „measure“ (nicht Teil des Standardlaufs): Messwerte des Prüfers – SHA-512-Durchsatz (Monocypher portabel, Vergleich OpenSSL über node:crypto) und Prüfzeit an einem
// Testbaum (Standard: 8 000 Dateien, 250 MB in einer Größenverteilung wie ein Next-Standalone-Paket; --tree <verzeichnis> misst ein echtes Paket), warm und „kalt“ (Seiten
// der Dateien aus dem Cache geworfen, posix_fadvise DONTNEED ohne Root – ein Betriebssystem-Cache darunter, etwa bei WSL2, bleibt).
//   node docker/test/run.mjs measure     (Umgebung: MEASURE_FILES, MEASURE_MB, MEASURE_TREE)
import { createHash, randomFillSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile, buildDir, buildStarter, makePackage, removeTree, repo, run, tempDir, vendorDir } from "./lib.mjs";
import { prng } from "./stage-parser.mjs";

export async function measureStage(log) {
  // SHA-512
  const bench = compile(join(buildDir, "crypto-bench"), [join(repo, "docker/test/crypto-test.c"), join(repo, "docker/verify.c"), join(vendorDir, "monocypher.c"), join(vendorDir, "monocypher-ed25519.c")], [
    "-std=gnu11", "-O2", "-D_FILE_OFFSET_BITS=64", `-I${vendorDir}`, `-I${join(repo, "docker")}`,
  ]);
  for (let i = 0; i < 3; i++) log(run(bench, ["--bench", "512"]).stdout.trim());
  const buf = Buffer.alloc(256 * 1024, 7);
  const t0 = process.hrtime.bigint();
  const h = createHash("sha512");
  for (let i = 0; i < 2048; i++) h.update(buf);
  h.digest();
  const s = Number(process.hrtime.bigint() - t0) / 1e9;
  log(`SHA-512 (OpenSSL über node:crypto, zum Vergleich): 512 MiB in ${s.toFixed(3)} s = ${(512 * 1048576 / 1e6 / s).toFixed(0)} MB/s`);

  // Testbaum
  const files = Number(process.env.MEASURE_FILES ?? 8000);
  const megabytes = Number(process.env.MEASURE_MB ?? 250);
  const dataDir = tempDir("so-measure-");
  try {
    let source = process.env.MEASURE_TREE;
    if (!source) {
      source = join(dataDir, "source");
      const rand = prng("measure/tree");
      const sizes = [];
      let total = 0;
      for (let i = 0; i < files; i++) {
        const size = Math.floor(Math.exp(rand.int(1000) / 1000 * 11) * 30); // 30 Bytes … ~1,6 MB, logarithmisch verteilt
        sizes.push(size);
        total += size;
      }
      const scale = (megabytes * 1048576) / total;
      const block = Buffer.alloc(8 * 1048576);
      randomFillSync(block);
      for (let i = 0; i < files; i++) {
        const dir = join(source, `d${i % 97}`, `e${i % 13}`);
        mkdirSync(dir, { recursive: true });
        const size = Math.max(1, Math.floor(sizes[i] * scale));
        writeFileSync(join(dir, `f${i}.bin`), block.subarray(i % 4096, (i % 4096) + Math.min(size, block.length - 4096)));
      }
    }
    const dir = join(dataDir, "pkg");
    mkdirSync(dir, { recursive: true });
    run("cp", ["-a", `${source}/.`, dir]);
    await makePackage(dataDir, "0.3.0", { dir }); // Dateiliste und Siegel über alles
    const binary = buildStarter("0.2.0-dev.abc1234", { production: true });
    const drop = compile(join(buildDir, "dropcache"), [join(repo, "docker/test/dropcache.c")], ["-std=gnu11", "-O1", "-D_GNU_SOURCE"]);
    const du = run("du", ["-sb", dir]).stdout.split("\t")[0];
    const count = run("sh", ["-c", `find '${dir}' | wc -l`]).stdout.trim();
    log(`Testbaum: ${count} Einträge, ${(Number(du) / 1048576).toFixed(0)} MiB`);
    for (const label of ["kalt", "warm", "warm", "kalt"]) {
      if (label === "kalt") run(drop, [dir]);
      const started = Date.now();
      const r = run(binary, ["--verify", dir, "--expect-version", "0.3.0", "--no-floor"], { env: { PATH: process.env.PATH, DATA_DIR: dataDir } });
      const wall = Date.now() - started;
      const json = JSON.parse(r.stdout.trim().split("\n").pop());
      log(`  Prüfung (${label}): ${json.ok ? "ok" : "FEHLER " + JSON.stringify(json)}, ${json.files} Einträge, ${((json.bytes ?? 0) / 1048576).toFixed(0)} MiB, ${json.ms} ms (Prozess ${wall} ms) = ${(((json.bytes ?? 0) / 1e6) / (json.ms / 1000)).toFixed(0)} MB/s`);
    }
  } finally {
    removeTree(dataDir);
  }
  return true;
}
