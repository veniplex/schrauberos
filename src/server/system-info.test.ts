import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setDiskSpaceForTest } from "@/lib/disk";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Angaben des Systemstatus: Größe der Datenbank samt Write-Ahead-Log, Version/Commit, Platz und neuestes Backup – jede Angabe fällt einzeln auf `null` zurück. */
let env: TestEnv;
let info: typeof import("./system-info");

before(async () => {
  env = await createTestEnv();
  info = await import("./system-info");
});
after(async () => {
  setDiskSpaceForTest(null);
  await env.cleanup();
});

describe("Systemstatus: Angaben des Servers", () => {
  it("Datenbankgröße: Datei und Write-Ahead-Log getrennt und zusammen; ohne Datei null", () => {
    const file = path.join(env.dir, "groesse.db");
    assert.equal(info.databaseSize(file), null);
    writeFileSync(file, Buffer.alloc(4096));
    assert.deepEqual(info.databaseSize(file), { fileBytes: 4096, walBytes: 0, totalBytes: 4096 });
    writeFileSync(`${file}-wal`, Buffer.alloc(1000));
    appendFileSync(`${file}-shm`, Buffer.alloc(32768)); // die Index-Datei im Speicher zählt nicht mit
    assert.deepEqual(info.databaseSize(file), { fileBytes: 4096, walBytes: 1000, totalBytes: 5096 });
  });

  it("Version: aus version.json samt Commit, Node ist die des laufenden Prozesses; ohne Datei der Entwicklungsstand", () => {
    const packaged = info.buildInfo({ version: "1.2.3", base: 3, node: "v99.0.0", arch: "arm64", commit: "abcdef1" });
    assert.equal(packaged.version, "1.2.3");
    assert.equal(packaged.commit, "abcdef1");
    assert.equal(packaged.node, process.version.replace(/^v/, ""), "Node des laufenden Prozesses, nicht die beim Bau notierte");
    assert.equal(packaged.packaged, true);
    const dev = info.buildInfo(null);
    assert.deepEqual([dev.version, dev.commit, dev.packaged], ["0.0.0-dev", null, false]);
  });

  it("systemInfo fasst Platz, Datenbank, neuestes Backup und Version zusammen; ohne Backup null, ohne Platzangabe null", async () => {
    setDiskSpaceForTest(async () => ({ freeBytes: 30, totalBytes: 100 }));
    const result = await info.systemInfo();
    assert.deepEqual(result.disk, { freeBytes: 30, totalBytes: 100 });
    assert.equal(result.newestBackup, null);
    assert.ok(result.build.version.length > 0);
    setDiskSpaceForTest(async () => null);
    assert.equal((await info.systemInfo()).disk, null);
  });
});
