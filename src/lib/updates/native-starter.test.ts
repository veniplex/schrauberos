import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Der C-Prüfer des Starters (docker/verify.c, docker/bootstrap.c) im regulären `npm test`: Krypto-Vektoren und Goldkorpus gegen das übersetzte Binary (Stufen `crypto` und
 * `corpus` von docker/test/run.mjs, etwa 30 s inklusive Übersetzen). Die übrigen Stufen (Mutationen, Parser-Differential, ASAN, Starter-Schleife, PID-Namensraum, Fuzz, Container)
 * laufen mit `npm run native:test` und in der CI-Stufe „native“.
 *
 * Ohne Linux oder ohne C-Compiler wird übersprungen (wie bei archive.test.ts); mit `REQUIRE_NATIVE=1` (CI) ist ein fehlender Compiler ein Fehler.
 */
const repo = path.resolve(import.meta.dirname, "../../..");
const required = process.env.REQUIRE_NATIVE === "1";
const hasCompiler = (cc: string) => spawnSync(cc, ["--version"], { encoding: "utf8" }).status === 0;
const compiler = process.platform === "linux" && [process.env.CC, "gcc", "clang"].some((cc) => cc && hasCompiler(cc));

describe("Starter-Prüfer (C), nativ", { skip: !required && !compiler ? (process.platform === "linux" ? "kein C-Compiler (gcc/clang)" : "nur unter Linux (unter Windows: npm run native:test über WSL)") : false }, () => {
  it("ein Compiler ist vorhanden (REQUIRE_NATIVE=1)", () => {
    assert.ok(compiler, "Für den Starter-Prüfer fehlen Linux oder gcc/clang – die CI-Stufe verlangt sie.");
  });

  it("Krypto-Vektoren und Goldkorpus bestehen (docker/test/run.mjs crypto corpus)", { timeout: 300_000 }, () => {
    const r = spawnSync(process.execPath, ["--no-warnings", "docker/test/run.mjs", "crypto", "corpus"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /OK: crypto/);
    assert.match(r.stdout, /OK: corpus/);
  });
});
