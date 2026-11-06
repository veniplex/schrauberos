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

describe("Migrations-Wächter: Umgehungsversuche (R2A-3)", () => {
  it("Unique-Index mit IF NOT EXISTS, Schema-Präfix, anderer Schreibweise und eckigen Klammern", () => {
    for (const sql of [
      `CREATE UNIQUE INDEX IF NOT EXISTS "Customer_email_key" ON "Customer"("email");`,
      `CREATE UNIQUE INDEX "Customer_email_key" ON main."Customer"("email");`,
      `CREATE UNIQUE INDEX "Customer_email_key" ON "main"."Customer"("email");`,
      `CREATE UNIQUE INDEX main."Customer_email_key" ON main.Customer(email);`,
      `CREATE UNIQUE INDEX Customer_email_key ON customer(email);`, // Tabellennamen sind unabhängig von der Schreibweise
      `CREATE UNIQUE INDEX [Customer_email_key] ON [Customer]([email]);`,
      `CREATE UNIQUE INDEX "x" ON "Customer"("email") WHERE "email" IS NOT NULL;`,
      `CREATE UNIQUE INDEX "x" ON "Customer"(lower("email"));`,
    ]) {
      assert.deepEqual(rulesOf(sql), ["unique"], sql);
    }
  });

  it("Blockkommentar vor oder mitten in einer verbotenen Anweisung", () => {
    assert.deepEqual(rulesOf(`/* harmlos */ DROP TABLE "Customer";`), ["drop"]);
    assert.deepEqual(rulesOf(`/* a
b */
DROP /* x */ TABLE "Customer";`), ["drop"]);
    assert.deepEqual(rulesOf(`/*! DROP TABLE "Customer"; */ DELETE FROM "Customer";`), ["data-change"]);
    // ein Kommentar, der Verbotenes nur erwähnt, ist harmlos – und ein nie geschlossener verschluckt den Rest, statt etwas zu verstecken
    assert.deepEqual(rulesOf(`/* DROP TABLE "Customer"; */ CREATE INDEX "i" ON "Customer"("a");`), []);
    assert.deepEqual(rulesOf(`CREATE INDEX "i" ON "Customer"("a"); /* DROP TABLE "Customer";`), []);
  });

  it("ADD und DROP ohne das Wort COLUMN", () => {
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" DROP "name";`), ["drop"]);
    assert.deepEqual(rulesOf(`ALTER TABLE main."Customer" DROP COLUMN "name";`), ["drop"]);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" ADD "x" TEXT NOT NULL;`), ["not-null"]);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" ADD "x" TEXT NOT NULL DEFAULT NULL;`), ["not-null"]);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" ADD "x" TEXT NOT NULL DEFAULT 'a';`), []);
    assert.deepEqual(rulesOf(`-- guard:allow unique: Eindeutiger Schlüssel, nullable
ALTER TABLE "Customer" ADD "key" TEXT;
CREATE UNIQUE INDEX "k" ON "Customer"("key");`), []);
  });

  it("DELETE/UPDATE in einem Trigger, über WITH und als Upsert", () => {
    const trigger = `CREATE TRIGGER "t" AFTER INSERT ON "Customer" BEGIN UPDATE "Customer" SET "name" = 'x' WHERE "id" = NEW."id"; DELETE FROM "Vehicle"; END;`;
    assert.deepEqual(rulesOf(trigger), ["trigger"]);
    assert.deepEqual(rulesOf(`CREATE TEMP TRIGGER "t" AFTER INSERT ON "Customer" BEGIN SELECT 1; END;`), ["trigger"]);
    assert.deepEqual(rulesOf(`-- guard:allow trigger: Protokoll der Einfügungen, nur lesend
${trigger}`), []);
    // der Rumpf bleibt eine Anweisung: danach geht es normal weiter
    assert.deepEqual(rulesOf(`${trigger}
DROP TABLE "Customer";`), ["trigger", "drop"]);
    assert.deepEqual(rulesOf(`WITH x AS (SELECT 1) DELETE FROM "Customer" WHERE "id" IN (SELECT * FROM x);`), ["data-change"]);
    assert.deepEqual(rulesOf(`INSERT INTO "Customer" ("id") VALUES ('1') ON CONFLICT("id") DO UPDATE SET "id" = 'x';`), ["data-change"]);
    assert.deepEqual(rulesOf(`INSERT INTO "Customer" ("id") VALUES ('1') ON CONFLICT("id") DO NOTHING;`), []);
  });

  it("PRAGMA, ATTACH, DETACH und VACUUM brauchen eine begründete Ausnahme", () => {
    for (const sql of [`PRAGMA writable_schema = ON;`, `PRAGMA foreign_keys=OFF;`, `ATTACH DATABASE 'x.db' AS x;`, `DETACH DATABASE x;`, `VACUUM;`]) {
      assert.deepEqual(rulesOf(sql), ["pragma"], sql);
      assert.deepEqual(rulesOf(`-- guard:allow pragma: Einmalig nötig für den Umbau
${sql}`), [], sql);
    }
  });

  it("Schlüsselwörter in Zeichenketten und Bezeichnern lösen keinen Fehlalarm aus", () => {
    assert.deepEqual(rulesOf(`INSERT INTO "Setting" ("key", "value") VALUES ('RENAME', 'DROP TABLE x');`), []);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" ADD COLUMN "rename" TEXT;`), []);
    assert.deepEqual(rulesOf(`ALTER TABLE "Customer" ADD COLUMN "note" TEXT DEFAULT 'UPDATE and DELETE FROM';`), []);
    assert.deepEqual(rulesOf(`INSERT INTO "Setting" ("key") VALUES ('a;b');
CREATE INDEX "i" ON "Customer"("a");`), []);
  });

  it("zerlegt Anweisungen mit Kommentaren in Zeichenketten und Trigger richtig", () => {
    assert.deepEqual(statementsOf(`A /* x; y */ B; 'a -- b'; C -- Rest
;`), ["A   B", "'a -- b'", "C"]);
    assert.equal(statementsOf(`CREATE TRIGGER t AFTER INSERT ON x BEGIN UPDATE y SET a = CASE WHEN 1 THEN 2 END; SELECT 1; END; SELECT 2;`).length, 2);
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
});
