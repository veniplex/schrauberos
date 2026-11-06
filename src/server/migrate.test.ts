import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { appliedMigrations, listMigrations, MigrationError, runMigrations } from "./migrate";

const root = mkdtempSync(path.join(tmpdir(), "so-migrate-"));
after(() => rmSync(root, { recursive: true, force: true }));

function makeMigrations(name: string, files: Record<string, string>) {
  const dir = path.join(root, name);
  for (const [migration, sql] of Object.entries(files)) {
    mkdirSync(path.join(dir, migration), { recursive: true });
    writeFileSync(path.join(dir, migration, "migration.sql"), sql);
  }
  return dir;
}

describe("Migrations-Läufer", () => {
  it("wendet Migrationen der Reihe nach an und ist wiederholbar", async () => {
    const dir = makeMigrations("a", {
      "20260101000000_one": `CREATE TABLE "A" ("id" INTEGER PRIMARY KEY);`,
      "20260102000000_two": `ALTER TABLE "A" ADD COLUMN "name" TEXT;`,
    });
    const file = path.join(root, "a.db");
    assert.deepEqual(await runMigrations(file, dir), ["20260101000000_one", "20260102000000_two"]);
    assert.deepEqual(await runMigrations(file, dir), []);
    assert.deepEqual(appliedMigrations(file), ["20260101000000_one", "20260102000000_two"]);
    const db = new Database(file);
    assert.ok(db.prepare(`SELECT name FROM pragma_table_info('A')`).all().some((c) => (c as { name: string }).name === "name"));
    db.close();
  });

  it("ruft beforeApply nur auf, wenn etwas anzuwenden ist", async () => {
    const dir = makeMigrations("b", { "20260101000000_one": `CREATE TABLE "B" ("id" INTEGER PRIMARY KEY);` });
    const file = path.join(root, "b.db");
    const seen: string[][] = [];
    await runMigrations(file, dir, (p) => void seen.push(p));
    await runMigrations(file, dir, (p) => void seen.push(p));
    assert.deepEqual(seen, [["20260101000000_one"]]);
  });

  it("macht eine fehlgeschlagene Migration vollständig rückgängig", async () => {
    const dir = makeMigrations("c", { "20260101000000_bad": `CREATE TABLE "C" ("id" INTEGER PRIMARY KEY); INSERT INTO "Gibtsnicht" VALUES (1);` });
    const file = path.join(root, "c.db");
    await assert.rejects(runMigrations(file, dir), (e) => e instanceof MigrationError && e.code === "failed");
    assert.deepEqual(appliedMigrations(file), []);
    const db = new Database(file);
    assert.equal((db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'C'`).get() as { n: number }).n, 0);
    db.close();
  });

  it("verweigert veränderte, bereits angewendete Migrationen", async () => {
    const dir = makeMigrations("d", { "20260101000000_one": `CREATE TABLE "D" ("id" INTEGER PRIMARY KEY);` });
    const file = path.join(root, "d.db");
    await runMigrations(file, dir);
    writeFileSync(path.join(dir, "20260101000000_one", "migration.sql"), `CREATE TABLE "D" ("id" INTEGER PRIMARY KEY, "x" TEXT);`);
    await assert.rejects(runMigrations(file, dir), (e) => e instanceof MigrationError && e.code === "changed");
  });

  it("toleriert in der Datenbank vorhandene, dem Code unbekannte Migrationen (Rückfall auf ältere Version)", async () => {
    const newer = makeMigrations("e-new", { "20260101000000_one": `CREATE TABLE "E" ("id" INTEGER PRIMARY KEY);`, "20260102000000_two": `ALTER TABLE "E" ADD COLUMN "x" TEXT;` });
    const older = makeMigrations("e-old", { "20260101000000_one": `CREATE TABLE "E" ("id" INTEGER PRIMARY KEY);` });
    const file = path.join(root, "e.db");
    await runMigrations(file, newer);
    assert.deepEqual(await runMigrations(file, older), []);
  });

  it("verletzt keine Fremdschlüssel bei Tabellenumbauten", async () => {
    const dir = makeMigrations("f", {
      "20260101000000_one": `CREATE TABLE "P" ("id" INTEGER PRIMARY KEY); CREATE TABLE "K" ("id" INTEGER PRIMARY KEY, "p" INTEGER REFERENCES "P"("id") ON DELETE CASCADE); INSERT INTO "P" VALUES (1); INSERT INTO "K" VALUES (1, 1);`,
      "20260102000000_two": `PRAGMA foreign_keys=OFF; CREATE TABLE "new_P" ("id" INTEGER PRIMARY KEY, "n" TEXT); INSERT INTO "new_P" ("id") SELECT "id" FROM "P"; DROP TABLE "P"; ALTER TABLE "new_P" RENAME TO "P"; PRAGMA foreign_keys=ON;`,
    });
    const file = path.join(root, "f.db");
    await runMigrations(file, dir);
    const db = new Database(file);
    // Der Umbau von P darf K nicht per CASCADE leeren
    assert.equal((db.prepare(`SELECT count(*) AS n FROM "K"`).get() as { n: number }).n, 1);
    db.close();
  });

  it("ist mit der Prisma-CLI kompatibel: gleiche Prüfsummen, Datenbank gilt als aktuell", async () => {
    const file = path.join(root, "prisma-compat.db");
    await runMigrations(file);
    const db = new Database(file, { readonly: true });
    const rows = db.prepare(`SELECT migration_name AS name, checksum FROM _prisma_migrations`).all() as { name: string; checksum: string }[];
    db.close();
    assert.deepEqual(rows.map((r) => r.name).sort(), listMigrations().map((m) => m.name));
    for (const m of listMigrations()) assert.equal(rows.find((r) => r.name === m.name)?.checksum, m.checksum);

    // Die Prisma-CLI selbst akzeptiert den Stand (Exit-Code 0 = keine offenen und keine abweichenden Migrationen) …
    const status = (url: string) => execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "status"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    assert.doesNotThrow(() => status(`file:${file}`));
    // … und meldet bei einer nicht migrierten Datenbank einen Fehler (Gegenprobe, damit die Prüfung aussagekräftig ist)
    assert.throws(() => status(`file:${path.join(root, "leer.db")}`));
  });
});
