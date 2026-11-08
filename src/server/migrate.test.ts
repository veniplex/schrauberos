import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { BASELINE_NAME } from "../lib/migration-guard";
import { appliedMigrations, AUTO_VACUUM_INCREMENTAL, listMigrations, MigrationError, REINSTALL_MESSAGE, runMigrations } from "./migrate";

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
    // Die CLI läuft im Projektordner (Schema, Konfiguration) ohne Telemetrie-/Update-Abfrage. **Ein** Wiederholungsversuch, und zwar nur bei der einen bekannten, unter Last auftretenden Fehlermeldung der
    // Schema-Engine („input contains invalid characters“, im Gesamtlauf unter Last in 1 von 3 Läufen (Block 13c, Linux-Container), allein nie; unter Windows auch mit acht parallelen Läufen nicht reproduzierbar): sie
    // stammt aus dem Parser der CLI und nicht aus unserer Migrationshistorie, die der Test prüft. Jeder andere Fehler – und der zweite Fehlschlag – bricht ab, mit der Ausgabe der CLI.
    const run = (url: string) =>
      execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "status"], {
        cwd: path.resolve("."),
        env: { ...process.env, DATABASE_URL: url, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
        stdio: "pipe",
        timeout: 60_000,
      });
    const status = (url: string) => {
      try {
        return run(url);
      } catch (error) {
        const output = `${(error as { stdout?: Buffer }).stdout ?? ""}${(error as { stderr?: Buffer }).stderr ?? ""}`;
        if (!/input contains invalid characters/.test(output)) throw Object.assign(error as Error, { message: `${(error as Error).message}\n${output}` });
        return run(url);
      }
    };
    assert.doesNotThrow(() => status(`file:${file}`));
    // … und meldet bei einer nicht migrierten Datenbank einen Fehler (Gegenprobe, damit die Prüfung aussagekräftig ist)
    assert.throws(() => status(`file:${path.join(root, "leer.db")}`));
  });
});

/** Eine Datenbank, wie sie eine ältere Version (0.1.0) hinterlässt: eigene Baseline-Prüfsumme, andere Migrationen, Tabellen mit Daten. */
function oldVolume(name: string, history: { name: string; checksum: string }[], withTables = true) {
  const file = path.join(root, name);
  const db = new Database(file);
  db.exec(`CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp, "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`);
  if (withTables) db.exec(`CREATE TABLE "Customer" ("id" TEXT PRIMARY KEY); INSERT INTO "Customer" VALUES ('alt');`);
  const insert = db.prepare(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)`);
  history.forEach((h, i) => insert.run(`id${i}`, h.checksum, "2026-11-06 10:00:00", h.name, "2026-11-06 10:00:00"));
  db.close();
  return file;
}

describe("Migrations-Läufer: fremde Migrationshistorie (alte Volumes)", () => {
  const foreign = (e: unknown) => e instanceof MigrationError && e.code === "foreignHistory" && e.message === REINSTALL_MESSAGE;

  it("verweigert ein Volume der Vorversion (gleiche Baseline-Namen, andere Prüfsumme, andere Migrationen) und verändert nichts", async () => {
    const file = oldVolume("v010.db", [
      { name: BASELINE_NAME, checksum: "a".repeat(64) },
      { name: "20261106095620_settings_and_timezone", checksum: "b".repeat(64) },
      { name: "20261106120000_files_on_disk", checksum: "c".repeat(64) },
    ]);
    const before = appliedMigrations(file);
    await assert.rejects(runMigrations(file), foreign);
    assert.deepEqual(appliedMigrations(file), before);
    const db = new Database(file, { readonly: true });
    assert.deepEqual(db.prepare(`SELECT id FROM "Customer"`).all(), [{ id: "alt" }]);
    db.close();
  });

  it("verweigert eine Historie ohne unsere Baseline (fremde Namen) und Tabellen ganz ohne Historie", async () => {
    await assert.rejects(runMigrations(oldVolume("fremd.db", [{ name: "20260101000000_init", checksum: "d".repeat(64) }])), foreign);
    await assert.rejects(runMigrations(oldVolume("ohne-historie.db", [])), foreign);
  });

  it("fasst eine fremde Datenbank byteweise nicht an: kein WAL-Modus, keine neue Tabelle, keine Nebendateien", async () => {
    // Eine fremde Datenbank im WAL-Modus (wie jede Datenbank dieser App), ohne Migrationstabelle, mit Daten
    const lonely = path.join(root, "fremd-wal.db");
    const db = new Database(lonely);
    db.pragma("journal_mode = WAL");
    db.exec(`CREATE TABLE "Kunde" ("id" TEXT PRIMARY KEY); INSERT INTO "Kunde" VALUES ('alt');`);
    db.close();
    const history = oldVolume("fremd-historie.db", [{ name: "20260101000000_init", checksum: "d".repeat(64) }]);
    for (const file of [lonely, history]) {
      const before = readFileSync(file);
      const filesBefore = readdirSync(root).sort();
      await assert.rejects(runMigrations(file), foreign);
      assert.ok(readFileSync(file).equals(before), `${path.basename(file)} wurde verändert`);
      assert.deepEqual(readdirSync(root).sort(), filesBefore, "es dürfen keine Nebendateien (-wal, -shm) entstehen");
    }
    const check = new Database(lonely, { readonly: true });
    assert.equal((check.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name = '_prisma_migrations'`).get() as { n: number }).n, 0);
    check.close();
  });

  it("nimmt unsere eigene Baseline samt unbekannter neuerer Migrationen an (Rückfall auf eine ältere Version)", async () => {
    const baseline = listMigrations()[0];
    assert.equal(baseline.name, BASELINE_NAME);
    const file = oldVolume("neuer.db", [{ name: BASELINE_NAME, checksum: baseline.checksum }, { name: "20990101000000_kommt_spaeter", checksum: "e".repeat(64) }], false);
    // Tabellen der Baseline sind nicht da, aber die Historie ist unsere – kein Fremdfall (die Migration gilt als angewendet)
    assert.deepEqual(await runMigrations(file), []);
  });

  it("legt auf einer leeren Datei und auf einer frischen Datenbank ganz normal an", async () => {
    const file = path.join(root, "frisch.db");
    assert.ok((await runMigrations(file)).includes(BASELINE_NAME));
    assert.deepEqual(await runMigrations(file), []);
  });
});

describe("Migrations-Läufer: auto_vacuum = INCREMENTAL (Z7)", () => {
  const modeOf = (file: string) => {
    const db = new Database(file, { readonly: true });
    try {
      return db.pragma("auto_vacuum", { simple: true });
    } finally {
      db.close();
    }
  };

  it("eine neue Datenbank hat auto_vacuum = 2 (INCREMENTAL) und läuft im WAL-Modus – die Reihenfolge der Anweisungen ist entscheidend", async () => {
    const file = path.join(root, "av-neu.db");
    await runMigrations(file);
    assert.equal(modeOf(file), AUTO_VACUUM_INCREMENTAL);
    const db = new Database(file);
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    db.close();
    // erst WAL, dann auto_vacuum bleibt wirkungslos (deshalb setzt der Läufer die Betriebsart zuerst)
    const wrong = path.join(root, "av-falsch.db");
    const w = new Database(wrong);
    w.pragma("journal_mode = WAL");
    w.pragma("auto_vacuum = INCREMENTAL");
    w.exec("CREATE TABLE t (x)");
    assert.equal(w.pragma("auto_vacuum", { simple: true }), 0);
    w.close();
  });

  it("eine bestehende Datenbank mit anderer Betriebsart wird nicht angefasst", async () => {
    const dir = makeMigrations("av-alt", { "20260101000000_one": `CREATE TABLE "A" ("id" INTEGER PRIMARY KEY);` });
    const file = path.join(root, "av-alt.db");
    const old = new Database(file);
    old.exec(`CREATE TABLE "Alt" ("id" INTEGER PRIMARY KEY)`);
    old.close();
    assert.equal(modeOf(file), 0);
    // fremde Tabelle ohne Historie → keine Veränderung (Baseline-Prüfung greift nur mit unserer Baseline; hier eigene Migration)
    await runMigrations(file, dir);
    assert.equal(modeOf(file), 0, "kein stilles VACUUM, keine Umstellung");
  });

  it("Löschen großer Datenmengen und PRAGMA incremental_vacuum verkleinern die Datei (auch nach einer Sicherungskopie)", async () => {
    const file = path.join(root, "av-schrumpf.db");
    await runMigrations(file);
    const db = new Database(file);
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      const base = statSync(file).size;
      db.exec(`CREATE TABLE "Big" ("id" INTEGER PRIMARY KEY, "blob" TEXT)`);
      const insert = db.prepare(`INSERT INTO "Big" ("blob") VALUES (?)`);
      db.transaction(() => {
        for (let i = 0; i < 3000; i++) insert.run("x".repeat(2000));
      })();
      db.pragma("wal_checkpoint(TRUNCATE)");
      const grown = statSync(file).size;
      assert.ok(grown > 5_000_000, `Datei gewachsen (${grown})`);
      db.exec(`DELETE FROM "Big"`);
      db.pragma("wal_checkpoint(TRUNCATE)");
      assert.equal(statSync(file).size, grown, "ohne Aufräumen bleibt die Datei so groß (freie Seiten)");
      assert.ok((db.pragma("freelist_count", { simple: true }) as number) > 1000);
      db.pragma("incremental_vacuum(100000)");
      db.pragma("wal_checkpoint(TRUNCATE)");
      const shrunk = statSync(file).size;
      assert.ok(shrunk < base + 100_000 && shrunk < grown / 3, `Datei geschrumpft (${grown} → ${shrunk}, leere Datenbank ${base})`);
      assert.equal(db.pragma("freelist_count", { simple: true }), 0);
      // die Online-Sicherung (Backup, Restore) behält die Betriebsart
      const copy = path.join(root, "av-kopie.db");
      await db.backup(copy);
      assert.equal(modeOf(copy), AUTO_VACUUM_INCREMENTAL);
    } finally {
      db.close();
    }
  });
});
