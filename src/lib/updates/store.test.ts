import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { afterFailure, afterInstall, emptyState } from "./state";
import { BLOCKED_KEEP, activeFile, pruneBlockedRemnants, pruneVersions, readActive, readMeta, readState, versionDir, versionsDir, writeState } from "./store";

const data = mkdtempSync(path.join(tmpdir(), "so-store-"));
after(() => rmSync(data, { recursive: true, force: true }));

describe("Update-Zustand auf der Platte", () => {
  it("schreibt mit dem Zustand auch den Zeiger, dem der Starter im Image folgt", () => {
    assert.equal(readActive(data), null);
    writeState(afterInstall(emptyState(), "1.2.0"), data);
    assert.equal(readActive(data), versionDir("1.2.0", data));
    assert.equal(readFileSync(activeFile(data), "utf8"), versionDir("1.2.0", data));
    assert.equal(readState(data).current, "1.2.0");
  });

  it("der Rückfall setzt den Zeiger auf die Vorversion bzw. leer (eingebaute Version)", () => {
    writeState(afterFailure(afterInstall(afterInstall(emptyState(), "1.1.0"), "1.2.0"), "x", "t"), data);
    assert.equal(readActive(data), versionDir("1.1.0", data));
    writeState(afterFailure(readState(data), "x", "t"), data);
    assert.equal(readActive(data), null);
    assert.equal(readFileSync(activeFile(data), "utf8"), "");
  });

  it("liest version.json samt Node-Version und Architektur", () => {
    const dir = path.join(data, "bundle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "version.json"), JSON.stringify({ version: "1.2.3", base: 3, node: "v24.1.0", arch: "x64" }));
    assert.deepEqual(readMeta(dir), { version: "1.2.3", base: 3, node: "v24.1.0", arch: "x64" });
    assert.equal(readMeta(path.join(data, "gibtsnicht")), null);
  });

  it("liest den Commit (nur zur Anzeige) und ignoriert Unsinn darin", () => {
    const dir = path.join(data, "bundle-commit");
    mkdirSync(dir, { recursive: true });
    const meta = (commit: unknown) => {
      writeFileSync(path.join(dir, "version.json"), JSON.stringify({ version: "1.2.3", base: 3, commit }));
      return readMeta(dir);
    };
    assert.deepEqual(meta("ABCDEF1"), { version: "1.2.3", base: 3, commit: "abcdef1" });
    for (const bad of ["<script>", "xyz1234", "abc", 12, null]) assert.deepEqual(meta(bad), { version: "1.2.3", base: 3 }, String(bad));
  });

  it("räumt nicht mehr gebrauchte Versionen und Zwischenordner auf", () => {
    for (const v of ["1.0.0", "1.1.0", ".partial-1.3.0"]) mkdirSync(path.join(versionsDir(data), v), { recursive: true });
    pruneVersions(["1.1.0"], data);
    assert.equal(existsSync(path.join(versionsDir(data), "1.1.0")), true);
    assert.equal(existsSync(path.join(versionsDir(data), "1.0.0")), false);
    assert.equal(existsSync(path.join(versionsDir(data), ".partial-1.3.0")), false);
  });
});

describe("Beiseitegeschobene Marker-Reste (`<Marker>.blocked-<ms>`)", () => {
  it("löscht nur eigene Reste, die älter als 7 Tage sind; die neuesten drei bleiben; Marker, Versionen und fremde Namen werden nie angefasst", () => {
    const root = mkdtempSync(path.join(tmpdir(), "so-blocked-"));
    try {
      const app = path.join(root, "app");
      mkdirSync(app, { recursive: true });
      const now = Date.now();
      const day = 24 * 3600_000;
      const make = (name: string, ageDays: number, dir = true) => {
        const full = path.join(app, name);
        if (dir) {
          mkdirSync(path.join(full, "innen"), { recursive: true });
          writeFileSync(path.join(full, "innen", "datei"), "x");
        } else writeFileSync(full, "x");
        const when = new Date(now - ageDays * day);
        utimesSync(full, when, when);
        return full;
      };
      const old = ["verify-failed.blocked-100", "inconclusive.blocked-200", "launcher-crash.blocked-300", "incompatible.blocked-400", "verify-ok.blocked-500"].map((n, i) => make(n, 30 + i));
      const young = make("verify-failed.blocked-900", 1);
      const foreign = [make("meine-datei.blocked-5", 90, false), make("verify-failed", 90, false), make("verify-failed.blocked-x", 90), make("anderes.blocked-77", 90)];
      mkdirSync(path.join(app, "versions", "1.0.0"), { recursive: true });

      // 6 Reste: die drei neuesten (young, 30, 31 Tage) bleiben, die älteren als 7 Tage unter den übrigen gehen
      assert.equal(pruneBlockedRemnants(root, now), 5 - (BLOCKED_KEEP - 1));
      assert.equal(existsSync(young), true);
      assert.equal(existsSync(old[0]), true);
      assert.equal(existsSync(old[1]), true);
      for (const gone of old.slice(2)) assert.equal(existsSync(gone), false, gone);
      for (const kept of foreign) assert.equal(existsSync(kept), true, kept);
      assert.equal(existsSync(path.join(app, "versions", "1.0.0")), true);
      assert.equal(pruneBlockedRemnants(root, now), 0, "zweiter Lauf: nichts mehr zu tun");

      // junge Reste bleiben auch über der Grenze (nur Alter zählt, nicht die Zahl); die nun nicht mehr neuesten alten gehen; ein fehlendes Verzeichnis ist kein Fehler
      const extra = ["verify-failed.blocked-1001", "verify-failed.blocked-1002", "verify-failed.blocked-1003"].map((n) => make(n, 2));
      assert.equal(pruneBlockedRemnants(root, now), 2);
      for (const kept of [young, ...extra]) assert.equal(existsSync(kept), true);
      assert.equal(existsSync(old[0]), false);
      assert.equal(existsSync(old[1]), false);
      assert.equal(pruneBlockedRemnants(path.join(root, "gibtsnicht"), now), 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
