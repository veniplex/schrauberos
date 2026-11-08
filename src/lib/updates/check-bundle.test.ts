import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/** `scripts/check-bundle.mjs` (Dockerfile, Stufe builder): kein Quelltext/.env/Test im Paket, alles Nötige darin. */
const repo = path.resolve(import.meta.dirname, "../../..");
let work: string;
before(() => {
  work = mkdtempSync(path.join(tmpdir(), "so-bundle-"));
});
after(() => rmSync(work, { recursive: true, force: true }));

const write = (root: string, rel: string, content = "x") => {
  const full = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  chmodSync(full, 0o644);
};

function goodBundle(name: string) {
  const dir = path.join(work, name);
  for (const rel of [
    "server.js",
    "package.json",
    ".next/BUILD_ID",
    ".next/server/app.js",
    ".next/static/a.js",
    "public/sw.js",
    "docs/platform/01-a.md",
    "assets/fonts/NotoSans-Regular.ttf",
    "assets/fonts/NotoSans-Bold.ttf",
    "prisma/migrations/00000000000000_baseline/migration.sql",
    "version.json",
    "THIRD-PARTY-NOTICES.md",
    "launcher.mjs",
    "runtime/node",
    "runtime/loader",
    "runtime/lib/libc.so.6",
    "node_modules/next/package.json",
    "node_modules/better-sqlite3/package.json",
  ])
    write(dir, rel);
  return dir;
}
const check = (dir: string) => {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join("scripts", "check-bundle.mjs"), dir], { cwd: repo, encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stderr}${r.stdout}` };
};

describe("check-bundle", () => {
  it("nimmt ein vollständiges Paket an", () => {
    assert.equal(check(goodBundle("ok")).ok, true);
  });

  it("weist Quelltext, Umgebungsdateien, Datenbanken und Tests ab", () => {
    for (const [name, rel] of [
      ["src", "src/app/page.tsx"],
      ["env", ".env"],
      ["env2", ".env.local"],
      ["db", "dev.db"],
      ["key", "secret.key"],
      ["token", "setup-token"],
      ["test", "lib/x.test.ts"],
      ["e2e", "e2e/tests/a.spec.ts"],
      ["data", ".data/secret.key"],
      ["sharp", "node_modules/sharp/package.json"], // libvips (LGPL-3.0) kommt nie ins Paket (Z6-3 M-9)
      ["img", "node_modules/@img/sharp-linux-x64/lib/x.node"],
      ["pem", "release-signing-key.pem"],
      ["pem2", "certs/ca.PEM"],
      ["keyfile", "keys/server.key"],
      ["p12", "keys/cert.p12"],
    ] as const) {
      const dir = goodBundle(`bad-${name}`);
      write(dir, rel);
      const r = check(dir);
      assert.equal(r.ok, false, `${rel} hätte abgewiesen werden müssen`);
    }
  });

  it("verlangt, was die App zur Laufzeit liest (Hilfe, Schrift, Migrationen)", () => {
    for (const rel of ["THIRD-PARTY-NOTICES.md", "docs/platform/01-a.md", "assets/fonts/NotoSans-Regular.ttf", "prisma/migrations/00000000000000_baseline/migration.sql", "runtime/node"]) {
      const dir = goodBundle(`missing-${path.basename(rel)}`);
      rmSync(path.join(dir, ...rel.split("/")), { recursive: true, force: true });
      if (rel.startsWith("docs/")) rmSync(path.join(dir, "docs"), { recursive: true, force: true });
      const r = check(dir);
      assert.equal(r.ok, false, `${rel} fehlt – hätte abgewiesen werden müssen`);
    }
  });

  it("lässt Testdateien und .env-Dateien in Paketen von node_modules zu, nicht aber Schreibrechte für Gruppe/Andere", { skip: process.platform === "win32" }, () => {
    const dir = goodBundle("modules");
    write(dir, "node_modules/next/dist/x.test.js");
    write(dir, "node_modules/some-pkg/test/cert.pem"); // Pakete bringen eigene Testzertifikate mit; die Namensregel für Schlüsseldateien gilt nur außerhalb von node_modules
    assert.equal(check(dir).ok, true);
    chmodSync(path.join(dir, "server.js"), 0o664);
    const r = check(dir);
    assert.equal(r.ok, false);
    assert.match(r.output, /schreibbar für Gruppe\/Andere: server\.js/);
  });
});
