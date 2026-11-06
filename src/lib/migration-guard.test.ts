import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { allowedRules, BASELINE_MARKER, BASELINE_NAME, checkMigration, statementsOf, tablesCreatedBy, type GuardRule } from "./migration-guard";

const EXISTING = new Set(["Customer", "Vehicle"]);
const rulesOf = (sql: string) => checkMigration(sql, EXISTING).map((v) => v.rule);

describe("Migrations-Wächter: Regeln", () => {
  it("erlaubt rein additive Änderungen", () => {
    const sql = `
      CREATE TABLE "Warranty" ("id" TEXT NOT NULL PRIMARY KEY, "note" TEXT NOT NULL, "customerId" TEXT NOT NULL);
      CREATE UNIQUE INDEX "Warranty_note_key" ON "Warranty"("note");
      ALTER TABLE "Customer" ADD COLUMN "nickname" TEXT;
      ALTER TABLE "Customer" ADD COLUMN "vip" BOOLEAN NOT NULL DEFAULT false;
      CREATE INDEX "Customer_nickname_idx" ON "Customer"("nickname");
      INSERT INTO "Setting" ("key") VALUES ('x');
    `;
    assert.deepEqual(checkMigration(sql, EXISTING), []);
  });

  it("verbietet DROP und RENAME", () => {
    assert.deepEqual(rulesOf(`DROP TABLE "Customer";`), ["drop"]);
    assert.deepEqual(rulesOf(`DROP INDEX "Customer_x_idx";`), ["drop"]);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" DROP COLUMN "name";`), ["drop"]);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" RENAME TO "Kunde";`), ["rename"]);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" RENAME COLUMN "a" TO "b";`), ["rename"]);
    // Der übliche Prisma-Tabellenumbau (RedefineTables) enthält beides
    assert.deepEqual(rulesOf(`CREATE TABLE "new_Customer" ("id" TEXT); INSERT INTO "new_Customer" SELECT * FROM "Customer"; DROP TABLE "Customer"; ALTER TABLE "new_Customer" RENAME TO "Customer";`), ["drop", "rename"]);
  });

  it("verbietet NOT NULL ohne Default bei neuen Spalten bestehender Tabellen", () => {
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" ADD COLUMN "x" TEXT NOT NULL;`), ["not-null"]);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" ADD COLUMN "x" TEXT NOT NULL DEFAULT '';`), []);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" ADD COLUMN "x" TEXT;`), []);
  });

  it("verbietet neue Unique-Indizes auf Bestandstabellen", () => {
    assert.deepEqual(rulesOf(`CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");`), ["unique"]);
    assert.deepEqual(rulesOf(`CREATE UNIQUE INDEX "Vehicle_a_b_key" ON "Vehicle"("a", "b");`), ["unique"]);
  });

  it("erlaubt einen Unique-Index nur auf einer neuen nullable Spalte und nur mit Marker samt Begründung", () => {
    const ok = `-- guard:allow unique: Eindeutiger Schlüssel, NULL bei Eingangsrechnungen\nALTER TABLE "Customer" ADD COLUMN "key" TEXT;\nCREATE UNIQUE INDEX "Customer_key_key" ON "Customer"("key");`;
    assert.deepEqual(rulesOf(ok), []);
    // ohne Marker
    assert.deepEqual(rulesOf(ok.split("\n").slice(1).join("\n")), ["unique"]);
    // Marker ohne Begründung zählt nicht
    assert.deepEqual(rulesOf(`-- guard:allow unique:\n` + ok.split("\n").slice(1).join("\n")), ["unique"]);
    // Marker, aber die Spalte ist nicht neu: weiter verboten
    assert.deepEqual(rulesOf(`-- guard:allow unique: Begründung steht hier\nCREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");`), ["unique"]);
    // Marker, aber die neue Spalte ist NOT NULL (mit Default): weiter verboten
    assert.deepEqual(rulesOf(`-- guard:allow unique: Begründung steht hier\nALTER TABLE "Customer" ADD COLUMN "key" TEXT NOT NULL DEFAULT 'a';\nCREATE UNIQUE INDEX "Customer_key_key" ON "Customer"("key");`), ["unique"]);
  });

  it("verlangt für DELETE/UPDATE einen Marker mit Begründung", () => {
    for (const sql of [`DELETE FROM "Customer";`, `UPDATE "Customer" SET "name" = 'x';`, `INSERT OR REPLACE INTO "Customer" ("id") VALUES ('1');`]) {
      assert.deepEqual(rulesOf(sql), ["data-change"], sql);
      assert.deepEqual(rulesOf(`-- guard:allow data-change: Altlast der Vorversion bereinigt\n${sql}`), [], sql);
    }
    assert.deepEqual(rulesOf(`-- guard:allow data-change: zu kurz\nDELETE FROM "Customer";`), ["data-change"]);
    // Ein Marker gilt nur für seine Regel
    assert.deepEqual(rulesOf(`-- guard:allow drop: Spalte seit zwei Releases ungenutzt\nDELETE FROM "Customer";`), ["data-change"]);
  });

  it("ignoriert Verbotenes in Kommentaren und Zeichenketten", () => {
    assert.deepEqual(rulesOf(`-- DROP TABLE "Customer"; DELETE FROM "Customer";\nINSERT INTO "Setting" ("key") VALUES ('DROP TABLE; -- x');`), []);
  });

  it("zerlegt Anweisungen und erkennt neue Tabellen", () => {
    assert.deepEqual(statementsOf(`A; -- x\nB 'a;b';\nC`), ["A", "B 'a;b'", "C"]);
    assert.deepEqual(tablesCreatedBy(`CREATE TABLE "X" ("id" TEXT);\nCREATE TABLE IF NOT EXISTS "Y" ("id" TEXT);`), ["X", "Y"]);
    assert.deepEqual([...allowedRules(`-- guard:allow rename: weil es sein muss\n-- guard:allow gibtsnicht: weil es sein muss`)], ["rename" satisfies GuardRule]);
  });
});

describe("Migrations-Wächter: echte Migrationen", () => {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

  it("beginnt mit der markierten Baseline", () => {
    assert.equal(names[0], BASELINE_NAME, "Die erste Migration muss die Baseline sein");
    const first = readFileSync(path.join(dir, BASELINE_NAME, "migration.sql"), "utf8").split(/\r?\n/, 1)[0];
    assert.ok(first.startsWith(BASELINE_MARKER), "Die Baseline trägt in der ersten Zeile den Marker (npm run db:baseline erzeugt ihn)");
    assert.match(first, /\b(unreleased|frozen)\b/);
  });

  it("alle Migrationen nach der Baseline sind additiv und rückfallkompatibel", () => {
    const tables = new Set(tablesCreatedBy(readFileSync(path.join(dir, BASELINE_NAME, "migration.sql"), "utf8")));
    assert.ok(tables.size > 10, "Die Baseline legt die Tabellen an");
    const problems: string[] = [];
    for (const name of names.slice(1)) {
      const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      for (const v of checkMigration(sql, tables)) problems.push(`${name}: [${v.rule}] ${v.message} (${v.statement})`);
      for (const t of tablesCreatedBy(sql)) tables.add(t);
    }
    assert.deepEqual(problems, []);
  });

  it("der Wächter schlägt bei einem verbotenen Beispiel tatsächlich an (kein Test, der immer grün ist)", () => {
    const tables = new Set(tablesCreatedBy(readFileSync(path.join(dir, BASELINE_NAME, "migration.sql"), "utf8")));
    const bad = checkMigration(`ALTER TABLE "User" RENAME TO "Benutzer";`, tables);
    assert.deepEqual(bad.map((v) => v.rule), ["rename"]);
  });

  it("db:baseline und db:check kennen den Marker", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "db-baseline.mjs"), "utf8");
    assert.ok(script.includes(`"${BASELINE_MARKER}"`));
    assert.ok(script.includes(`"${BASELINE_NAME}"`) || script.includes(BASELINE_NAME));
  });
});
