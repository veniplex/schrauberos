import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { installFakes } from "@/test/harness";

/**
 * Alter Volume (Version 0.1.0): Die App darf nicht in einer Neustart-Schleife abstürzen, sondern bleibt mit Status „reinstall“
 * stehen, meldet das im Log und im Health-Endpoint und verändert die fremde Datenbank nicht.
 */
const dir = mkdtempSync(path.join(tmpdir(), "so-oldvolume-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("Start mit fremdem (altem) Volume", () => {
  it("meldet „Neuinstallation nötig“, beendet den Prozess nicht und lässt die Datenbank unverändert", async () => {
    installFakes();
    const file = path.join(dir, "schrauberos.db");
    process.env.DATA_DIR = dir;
    process.env.DATABASE_URL = `file:${file}`;
    // Datenbank der Vorversion: eigene Baseline-Prüfsumme, dazu Migrationen, die es nicht mehr gibt
    const old = new Database(file);
    old.exec(`CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp, "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0);
      CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "username" TEXT); INSERT INTO "User" VALUES ('1', 'chef');
      INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name) VALUES ('a', '${"f".repeat(64)}', '2026-11-06 10:00:00', '00000000000000_baseline'), ('b', '${"1".repeat(64)}', '2026-11-06 10:00:00', '20261106140000_handbook');`);
    old.close();

    const errors: string[] = [];
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = (...args: unknown[]) => void errors.push(args.join(" "));
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code}) darf nicht aufgerufen werden`);
    }) as typeof process.exit;
    try {
      const { startApp } = await import("./startup");
      const { startupState } = await import("./startup-state");
      await startApp();
      assert.equal(startupState().status, "reinstall");
      assert.match(startupState().error ?? "", /Neuinstallation nötig/);
      assert.ok(errors.some((e) => e.includes("Neuinstallation nötig")), "klare Meldung im Log");

      // Health-Endpoint: 503 mit Status „reinstall“ (der Launcher wertet das als endgültig)
      const { GET } = await import("@/app/api/health/route");
      const res = await GET();
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.status, "reinstall");
      const { healthVerdict } = await import("@/lib/updates/health");
      assert.equal(healthVerdict(res.status, body), "fatal");
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    const after = new Database(file, { readonly: true });
    assert.deepEqual(after.prepare(`SELECT username FROM "User"`).all(), [{ username: "chef" }]);
    assert.equal((after.prepare(`SELECT count(*) AS n FROM _prisma_migrations`).get() as { n: number }).n, 2);
    after.close();
    // Kein Einrichtungs-Token für eine fremde Datenbank
    assert.throws(() => readFileSync(path.join(dir, "setup-token")));
  });
});
