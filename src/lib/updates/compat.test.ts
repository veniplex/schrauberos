import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { blockedMigrations, knownMigrations, readAppliedMigrations, unknownMigrations } from "./compat";

const work = mkdtempSync(path.join(tmpdir(), "so-compat-"));
after(() => rmSync(work, { recursive: true, force: true }));

describe("Kompatibilitätsschranke", () => {
  it("unknownMigrations: was die Datenbank kennt und das Paket nicht", () => {
    assert.deepEqual(unknownMigrations(["a", "b", "c"], ["a", "c"]), ["b"]);
    assert.deepEqual(unknownMigrations([], ["a"]), []);
    assert.deepEqual(unknownMigrations(["a"], ["a", "b"]), [], "das Paket darf mehr kennen");
  });

  it("blockedMigrations: nur beim Rückfall von einer bewährten Version, und nur mit lesbarer Datenbank", () => {
    const input = { applied: ["a", "b"], known: ["a"], fromConfirmed: true };
    assert.deepEqual(blockedMigrations(input), ["b"]);
    assert.deepEqual(blockedMigrations({ ...input, fromConfirmed: false }), [], "frisches, unbestätigtes Update: vorgesehene Rücknahme");
    assert.deepEqual(blockedMigrations({ ...input, applied: null }), [], "Datenbank nicht lesbar: kein Urteil");
    assert.deepEqual(blockedMigrations({ ...input, known: ["a", "b"] }), []);
  });

  it("knownMigrations: nur Migrationsordner mit gültigem Namen, sortiert", () => {
    const dir = path.join(work, "pkg");
    for (const name of ["20260301000000_neu", "00000000000000_baseline", "keine_migration", "migration_lock.toml"]) mkdirSync(path.join(dir, "prisma", "migrations", name), { recursive: true });
    writeFileSync(path.join(dir, "prisma", "migrations", "20990101000000_datei"), "keine Ordner-Migration");
    assert.deepEqual(knownMigrations(dir), ["00000000000000_baseline", "20260301000000_neu"]);
    assert.deepEqual(knownMigrations(path.join(work, "gibtsnicht")), []);
  });

  it("readAppliedMigrations liest eine echte SQLite-Datei nur lesend; fehlende Datei oder Tabelle: null", () => {
    const file = path.join(work, "test.db");
    const db = new Database(file);
    db.exec(`CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at TEXT, rolled_back_at TEXT)`);
    db.prepare(`INSERT INTO _prisma_migrations VALUES (?, ?, ?)`).run("00000000000000_baseline", "2026-01-01", null);
    db.prepare(`INSERT INTO _prisma_migrations VALUES (?, ?, ?)`).run("20260301000000_unfertig", null, null);
    db.prepare(`INSERT INTO _prisma_migrations VALUES (?, ?, ?)`).run("20260401000000_zurueck", "2026-01-01", "2026-01-02");
    db.close();
    const open = (f: string) => new Database(f, { readonly: true, fileMustExist: true });
    assert.deepEqual(readAppliedMigrations(file, open), ["00000000000000_baseline"]);
    assert.equal(readAppliedMigrations(path.join(work, "gibtsnicht.db"), open), null);
    const empty = path.join(work, "leer.db");
    new Database(empty).close();
    assert.equal(readAppliedMigrations(empty, open), null, "keine Historientabelle");
  });
});
