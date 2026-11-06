import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { afterFailure, afterInstall, emptyState } from "./state";
import { activeFile, pruneVersions, readActive, readMeta, readState, versionDir, versionsDir, writeState } from "./store";

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

  it("räumt nicht mehr gebrauchte Versionen und Zwischenordner auf", () => {
    for (const v of ["1.0.0", "1.1.0", ".partial-1.3.0"]) mkdirSync(path.join(versionsDir(data), v), { recursive: true });
    pruneVersions(["1.1.0"], data);
    assert.equal(existsSync(path.join(versionsDir(data), "1.1.0")), true);
    assert.equal(existsSync(path.join(versionsDir(data), "1.0.0")), false);
    assert.equal(existsSync(path.join(versionsDir(data), ".partial-1.3.0")), false);
  });
});
