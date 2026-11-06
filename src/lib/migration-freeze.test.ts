import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { compareToRelease, digestOf, baselineBody, freezeMigrations, parseBaselineMarker, PUBLISHED_FILE, verifyMigrations } from "./migration-freeze";
import { BASELINE_MARKER, BASELINE_NAME } from "./migration-guard";

/** Eingefrorene Migrationen: Prüfsummen von Baseline und veröffentlichten Migrationen, an echten Dateien (temporäre Kopien) geprüft. */
const root = mkdtempSync(path.join(tmpdir(), "so-freeze-"));
after(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
/** Frischer Projektordner mit `prisma/migrations` (Baseline „unreleased“ und optional weitere Migrationen). */
function project(extra: Record<string, string> = {}) {
  const dir = path.join(root, `p${++counter}`);
  const migrations = path.join(dir, "prisma", "migrations");
  mkdirSync(path.join(migrations, BASELINE_NAME), { recursive: true });
  writeFileSync(path.join(migrations, BASELINE_NAME, "migration.sql"), `${BASELINE_MARKER} unreleased (Test)\n-- CreateTable\nCREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);\n`);
  for (const [name, sql] of Object.entries(extra)) {
    mkdirSync(path.join(migrations, name), { recursive: true });
    writeFileSync(path.join(migrations, name, "migration.sql"), sql);
  }
  return { dir, layout: { dir: migrations, publishedFile: path.join(dir, "prisma", PUBLISHED_FILE) }, baseline: path.join(migrations, BASELINE_NAME, "migration.sql") };
}
const baselineOf = (p: ReturnType<typeof project>) => readFileSync(p.baseline, "utf8");

describe("Marker und Prüfsumme", () => {
  it("liest unreleased und frozen (mit und ohne Prüfsumme) und erkennt fehlende Marker", () => {
    assert.deepEqual(parseBaselineMarker(`${BASELINE_MARKER} unreleased (x)\nSELECT 1;`), { state: "unreleased" });
    assert.deepEqual(parseBaselineMarker(`${BASELINE_MARKER} frozen sha256:${"a".repeat(64)}\nSELECT 1;`), { state: "frozen", sha256: "a".repeat(64) });
    assert.deepEqual(parseBaselineMarker(`${BASELINE_MARKER} frozen\nSELECT 1;`), { state: "frozen", sha256: null });
    assert.equal(parseBaselineMarker("CREATE TABLE x;"), null);
    assert.equal(parseBaselineMarker(`${BASELINE_MARKER} irgendwas\n`), null);
  });

  it("die Prüfsumme ist unabhängig von Zeilenenden (Git unter Windows) und vom Marker selbst", () => {
    assert.equal(digestOf("a\r\nb\r\n"), digestOf("a\nb\n"));
    assert.equal(baselineBody("MARKER a\r\nB\r\n"), "B\n");
  });
});

describe("Baseline einfrieren und prüfen", () => {
  it("unreleased ist in Ordnung; im Release-Modus (Versions-Tag) nicht", () => {
    const p = project();
    assert.deepEqual(verifyMigrations(p.layout), []);
    assert.match(verifyMigrations(p.layout, { release: true }).join("\n"), /noch nicht eingefroren/);
  });

  it("friert ein: Marker mit Prüfsumme; danach ist es auch im Release-Modus in Ordnung", () => {
    const p = project();
    const result = freezeMigrations(p.layout);
    assert.equal(result.baselineFrozen, true);
    assert.match(baselineOf(p).split("\n", 1)[0], new RegExp(`^${BASELINE_MARKER} frozen sha256:[0-9a-f]{64}$`));
    assert.deepEqual(verifyMigrations(p.layout, { release: true }), []);
    // zweites Einfrieren ändert nichts
    const again = freezeMigrations(p.layout);
    assert.deepEqual(again, { baselineFrozen: false, added: [] });
  });

  it("eine veränderte eingefrorene Baseline wird erkannt (jede Änderung am Rumpf, auch nur ein Zeichen)", () => {
    const p = project();
    freezeMigrations(p.layout);
    writeFileSync(p.baseline, baselineOf(p).replace('"id" TEXT', '"id" INTEGER'));
    const problems = verifyMigrations(p.layout);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Baseline wurde verändert/);
    // auch das Entfernen der Prüfsumme (zurück auf bloßes „frozen“) fällt auf
    writeFileSync(p.baseline, baselineOf(p).replace(/ sha256:[0-9a-f]{64}/, ""));
    assert.match(verifyMigrations(p.layout).join("\n"), /keine Prüfsumme/);
  });

  it("tarnen als „unreleased“ funktioniert nicht, sobald veröffentlichte Migrationen eingetragen sind", () => {
    const p = project({ "20270101000000_add_x": `ALTER TABLE "User" ADD COLUMN "x" TEXT;\n` });
    freezeMigrations(p.layout);
    writeFileSync(p.baseline, baselineOf(p).replace(/^.*\n/, `${BASELINE_MARKER} unreleased\n`));
    assert.match(verifyMigrations(p.layout).join("\n"), /Baseline ist aber „unreleased“/);
  });
});

describe("Veröffentlichte Migrationen nach der Baseline", () => {
  it("werden mit Prüfsumme eingetragen; eine Änderung, Löschung oder Umbenennung fällt auf", () => {
    const p = project({ "20270101000000_add_x": `ALTER TABLE "User" ADD COLUMN "x" TEXT;\n` });
    assert.deepEqual(freezeMigrations(p.layout), { baselineFrozen: true, added: ["20270101000000_add_x"] });
    const published = JSON.parse(readFileSync(p.layout.publishedFile, "utf8")) as Record<string, string>;
    assert.deepEqual(Object.keys(published), ["20270101000000_add_x"]);
    assert.match(published["20270101000000_add_x"], /^[0-9a-f]{64}$/);
    assert.deepEqual(verifyMigrations(p.layout, { release: true }), []);

    const file = path.join(p.layout.dir, "20270101000000_add_x", "migration.sql");
    writeFileSync(file, `ALTER TABLE "User" ADD COLUMN "y" TEXT;\n`);
    assert.match(verifyMigrations(p.layout).join("\n"), /20270101000000_add_x wurde verändert/);
    rmSync(path.join(p.layout.dir, "20270101000000_add_x"), { recursive: true });
    assert.match(verifyMigrations(p.layout).join("\n"), /20270101000000_add_x fehlt/);
  });

  it("neue, noch nicht veröffentlichte Migrationen dürfen sich ändern – im Release-Modus müssen sie erfasst sein", () => {
    const p = project();
    freezeMigrations(p.layout);
    mkdirSync(path.join(p.layout.dir, "20270201000000_add_y"));
    writeFileSync(path.join(p.layout.dir, "20270201000000_add_y", "migration.sql"), `ALTER TABLE "User" ADD COLUMN "y" TEXT;\n`);
    assert.deepEqual(verifyMigrations(p.layout), []);
    assert.match(verifyMigrations(p.layout, { release: true }).join("\n"), /20270201000000_add_y ist nicht als veröffentlicht eingetragen/);
    assert.deepEqual(freezeMigrations(p.layout).added, ["20270201000000_add_y"]);
    assert.deepEqual(verifyMigrations(p.layout, { release: true }), []);
  });

  it("ein bereits erfasster Eintrag wird beim erneuten Einfrieren nie überschrieben", () => {
    const p = project({ "20270101000000_add_x": `ALTER TABLE "User" ADD COLUMN "x" TEXT;\n` });
    freezeMigrations(p.layout);
    writeFileSync(path.join(p.layout.dir, "20270101000000_add_x", "migration.sql"), `ALTER TABLE "User" ADD COLUMN "z" TEXT;\n`);
    assert.throws(() => freezeMigrations(p.layout), /wurde verändert/);
  });
});

describe("Vergleich mit dem letzten Release", () => {
  it("nur hinzugekommene Dateien sind in Ordnung", () => {
    assert.deepEqual(compareToRelease("A\tprisma/migrations/20270101000000_x/migration.sql\n"), []);
    assert.equal(compareToRelease("M\tprisma/migrations/00000000000000_baseline/migration.sql\n").length, 1);
    assert.match(compareToRelease("D\tprisma/migrations/20260101000000_y/migration.sql")[0], /gelöscht/);
    assert.equal(compareToRelease("A\ta\nM\tb\nD\tc\n").length, 2);
  });
});

describe("Pipeline-Schritt npm run db:release-check (echtes Git-Repository)", () => {
  const script = path.join(process.cwd(), "scripts", "db-freeze.ts");
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [tsx, script, ...args, "--root", cwd], { encoding: "utf8" });
  const commit = (cwd: string, message: string) => {
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", message);
  };

  it("verlangt eingefrorene Migrationen, erlaubt Neues nach dem Release und verbietet Änderungen an Veröffentlichtem", () => {
    const p = project();
    git(p.dir, "init", "-q");
    // nicht eingefroren: Abbruch
    commit(p.dir, "unreleased");
    const early = run(p.dir, "check-release", "--tag", "v0.2.0");
    assert.equal(early.status, 1, early.stdout + early.stderr);
    assert.match(early.stderr, /noch nicht eingefroren/);

    // einfrieren (wie `npm run db:freeze`) und veröffentlichen
    assert.equal(run(p.dir, "freeze").status, 0);
    commit(p.dir, "freeze");
    git(p.dir, "tag", "v0.2.0");
    const first = run(p.dir, "check-release", "--tag", "v0.2.0");
    assert.equal(first.status, 0, first.stdout + first.stderr);

    // nächstes Release: neue additive Migration, eingefroren -> in Ordnung, Vergleich gegen v0.2.0
    mkdirSync(path.join(p.layout.dir, "20270101000000_add_x"));
    writeFileSync(path.join(p.layout.dir, "20270101000000_add_x", "migration.sql"), `ALTER TABLE "User" ADD COLUMN "x" TEXT;\n`);
    assert.equal(run(p.dir, "freeze").status, 0);
    commit(p.dir, "next");
    const next = run(p.dir, "check-release", "--tag", "v0.3.0");
    assert.equal(next.status, 0, next.stdout + next.stderr);
    assert.match(next.stdout, /gegenüber v0\.2\.0/);
    git(p.dir, "tag", "v0.3.0");

    // Die veröffentlichte Baseline anfassen UND die Prüfsumme „nachziehen“: Prüfsummen allein genügen nicht, der Vergleich mit dem Tag fängt es
    const body = baselineBody(baselineOf(p)).replace('"id" TEXT', '"id" INTEGER');
    writeFileSync(p.baseline, `${BASELINE_MARKER} frozen sha256:${digestOf(body)}\n${body}`);
    commit(p.dir, "tampered");
    const tampered = run(p.dir, "check-release", "--tag", "v0.4.0");
    assert.equal(tampered.status, 1, tampered.stdout + tampered.stderr);
    assert.match(tampered.stderr, /gegenüber v0\.3\.0.*00000000000000_baseline/);
  });
});

describe("db:baseline verweigert die Arbeit, wenn die Baseline nicht (mehr) ‚unreleased‘ ist", () => {
  const script = path.join(process.cwd(), "scripts", "db-baseline.mjs");
  const attempt = (baselineSql: string | null) => {
    const dir = path.join(root, `b${++counter}`);
    if (baselineSql !== null) {
      mkdirSync(path.join(dir, BASELINE_NAME), { recursive: true });
      writeFileSync(path.join(dir, BASELINE_NAME, "migration.sql"), baselineSql);
    } else mkdirSync(dir, { recursive: true });
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, MIGRATIONS_DIR: dir } });
    return { result, file: path.join(dir, BASELINE_NAME, "migration.sql") };
  };

  it("bei einer eingefrorenen Baseline: Abbruch, Datei unverändert", () => {
    const sql = `${BASELINE_MARKER} frozen sha256:${"0".repeat(64)}\nCREATE TABLE "User" ("id" TEXT);\n`;
    const { result, file } = attempt(sql);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /veröffentlicht \(frozen\)/);
    assert.equal(readFileSync(file, "utf8"), sql);
  });

  it("bei einer Baseline ohne Marker: Abbruch, Datei unverändert", () => {
    const sql = `-- CreateTable\nCREATE TABLE "User" ("id" TEXT);\n`;
    const { result, file } = attempt(sql);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /keinen Marker/);
    assert.equal(readFileSync(file, "utf8"), sql);
  });
});

describe("die echten Migrationen des Projekts", () => {
  it("sind in sich stimmig (Marker, Prüfsummen eingefrorener Teile)", () => {
    const real = path.join(process.cwd(), "prisma");
    assert.deepEqual(verifyMigrations({ dir: path.join(real, "migrations"), publishedFile: path.join(real, PUBLISHED_FILE) }), []);
  });

  it("der Test erkennt eine Veränderung tatsächlich (Kopie der echten Baseline, eingefroren und dann verändert)", () => {
    const p = project();
    cpSync(path.join(process.cwd(), "prisma", "migrations", BASELINE_NAME, "migration.sql"), p.baseline);
    // die echte Baseline kann „unreleased“ oder „frozen“ sein: auf jeden Fall einfrieren, dann verändern
    const sql = readFileSync(p.baseline, "utf8");
    if (parseBaselineMarker(sql)?.state === "frozen") writeFileSync(p.baseline, sql.replace(/^.*\n/, `${BASELINE_MARKER} unreleased\n`));
    freezeMigrations(p.layout);
    assert.deepEqual(verifyMigrations(p.layout), []);
    writeFileSync(p.baseline, baselineOf(p).replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    assert.notDeepEqual(verifyMigrations(p.layout), []);
  });
});
