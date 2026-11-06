import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as tar from "tar";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { applyPendingRestore, readPending } from "@/lib/updates/restore";
import { runMigrations } from "@/server/migrate";
import { filesDir, resolveRel, storeFile } from "@/server/files";
import { BACKUP_KINDS, backupPath, backupsDir, createBackup, deleteBackup, isBackupName, linkTree, listBackups, pruneBackups } from "./core";
import { importBackupFile, readDatabaseArchive, RestoreError, stageRestore, validateDatabase } from "./restore";

const data = mkdtempSync(path.join(tmpdir(), "so-backup-"));
process.env.DATA_DIR = data;
const dbFile = path.join(data, "live.db");
process.env.DATABASE_URL = `file:${dbFile}`; // stageRestore sichert den Ist-Stand der „laufenden“ Datenbank
after(() => rmSync(data, { recursive: true, force: true }));

const codeOf = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof RestoreError ? e.code : "other";
  }
  return null;
};
const UNLIMITED = Object.fromEntries(BACKUP_KINDS.map((k) => [k, { keep: 0, days: 0 }])) as Record<(typeof BACKUP_KINDS)[number], { keep: number; days: number }>;
const bytes = (s: string) => new TextEncoder().encode(s);
let manual = "";

describe("Backups", () => {
  it("legt konsistente, prüfbare Sicherungen mit Datenbank und Dateien im laufenden Betrieb an", async () => {
    await runMigrations(dbFile);
    const live = new Database(dbFile);
    live.exec(`INSERT INTO "Workshop" (id, name, updatedAt) VALUES ('default', 'Meine Firma', CURRENT_TIMESTAMP)`);
    const beleg = await storeFile("rechnungen/2026/eingang", "2026-01-05_Lieferant_RE-1.pdf", bytes("BELEG EINS"));
    const info = await createBackup("manual", dbFile);
    manual = info.name;
    assert.match(info.name, /^schrauberos-\d{8}T\d{6}Z-manual$/);
    assert.ok(info.size > 0);
    assert.equal(info.fileCount, 1);
    assert.equal(info.fileBytes, 10);

    // Datenbank: enthält den Stand und ist gültig
    const copy = path.join(data, "check.db");
    writeFileSync(copy, readDatabaseArchive(info.name));
    const check = new Database(copy, { readonly: true });
    assert.equal((check.prepare(`SELECT name FROM "Workshop"`).get() as { name: string }).name, "Meine Firma");
    check.close();
    live.close();

    // Dateien: als Hardlink – derselbe Inhalt, aber kein zusätzlicher Platz
    const inBackup = path.join(backupPath(info.name)!, "files", ...beleg.split("/"));
    assert.equal(readFileSync(inBackup, "utf8"), "BELEG EINS");
    assert.equal(statSync(inBackup).ino, statSync(resolveRel(beleg)).ino);
  });

  it("ein Backup behält Dateien, die später aus dem Live-Bestand verschwinden", async () => {
    const belegPfad = "rechnungen/2026/eingang/2026-01-05_Lieferant_RE-1.pdf";
    rmSync(resolveRel(belegPfad));
    const inBackup = path.join(backupPath(manual)!, "files", "rechnungen", "2026", "eingang", "2026-01-05_Lieferant_RE-1.pdf");
    assert.equal(readFileSync(inBackup, "utf8"), "BELEG EINS");
  });

  it("akzeptiert nur feste Namen (kein Pfad-Trick)", () => {
    assert.equal(isBackupName("schrauberos-20260101T020000Z-auto"), true);
    for (const bad of ["../x", "schrauberos-20260101T020000Z-auto/../../etc", "x", "schrauberos-1-auto", "schrauberos-20260101T020000Z-auto.db.gz"]) {
      assert.equal(isBackupName(bad), false);
      assert.equal(backupPath(bad), null);
    }
    assert.equal(deleteBackup("../../etc"), false);
  });

  it("behält von den automatischen Sicherungen nur die neuesten", async () => {
    for (let i = 1; i <= 4; i++) await createBackup("auto", dbFile, new Date(Date.UTC(2026, 0, i, 2, 0, 0)));
    assert.equal(pruneBackups({ ...UNLIMITED, auto: { keep: 2, days: 0 } }, new Date("2026-01-05T00:00:00Z")).length, 2);
    assert.deepEqual(listBackups().filter((b) => b.kind === "auto").map((b) => b.createdAt.getUTCDate()), [4, 3]);
    assert.ok(listBackups().some((b) => b.kind === "manual"));
  });

  it("Aufbewahrung je Art: Anzahl und Alter gelten getrennt; 0 = unbegrenzt; das neueste Backup überhaupt bleibt immer", async () => {
    // eigenes Datenverzeichnis: die übrigen Tests dieser Datei brauchen ihre Sicherungen
    const isolated = mkdtempSync(path.join(tmpdir(), "so-retention-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = isolated;
    after(() => rmSync(isolated, { recursive: true, force: true }));
    const at = (day: number) => new Date(Date.UTC(2026, 2, day, 2, 0, 0));
    for (const day of [1, 2, 3]) await createBackup("pre-update", dbFile, at(day));
    for (const day of [1, 2]) await createBackup("manual", dbFile, at(day));
    await createBackup("auto", dbFile, at(2));
    const now = new Date("2026-03-20T00:00:00Z");
    const kept = () => listBackups().map((b) => `${b.kind}:${b.createdAt.getUTCDate()}`).sort();

    // nur Anzahl: von „vor Update“ die zwei neuesten
    pruneBackups({ ...UNLIMITED, "pre-update": { keep: 2, days: 0 } }, now);
    assert.deepEqual(kept(), ["auto:2", "manual:1", "manual:2", "pre-update:2", "pre-update:3"]);
    // nur Alter: manuelle höchstens 18 Tage (am 20.3.: der vom 1.3. ist 19 Tage alt, der vom 2.3. 18)
    pruneBackups({ ...UNLIMITED, manual: { keep: 0, days: 18 } }, now);
    assert.deepEqual(kept(), ["auto:2", "manual:2", "pre-update:2", "pre-update:3"]);
    // alles zu alt: das neueste Backup überhaupt (pre-update vom 3.3.) bleibt trotzdem
    const doomed = pruneBackups({ ...Object.fromEntries(BACKUP_KINDS.map((k) => [k, { keep: 0, days: 1 }])) } as typeof UNLIMITED, now);
    assert.equal(doomed.length, 3);
    assert.deepEqual(kept(), ["pre-update:3"]);
    process.env.DATA_DIR = previous;
  });

  it("linkTree ist asynchron: der Event-Loop läuft während des Verlinkens weiter, auch bei vielen Dateien", async () => {
    const src = path.join(data, "viele");
    for (let d = 0; d < 20; d++) {
      mkdirSync(path.join(src, `d${d}`), { recursive: true });
      for (let i = 0; i < 100; i++) writeFileSync(path.join(src, `d${d}`, `f${i}.txt`), `${d}-${i}`);
    }
    writeFileSync(path.join(src, ".versteckt"), "x");
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const result = await linkTree(src, path.join(data, "viele-link"));
    clearInterval(timer);
    assert.deepEqual({ count: result.count }, { count: 2000 });
    assert.ok(ticks > 0, "zwischendurch kam der Event-Loop zum Zug");
    assert.equal(existsSync(path.join(data, "viele-link", ".versteckt")), false);
    assert.equal(readFileSync(path.join(data, "viele-link", "d3", "f7.txt"), "utf8"), "3-7");
    rmSync(src, { recursive: true, force: true });
    rmSync(path.join(data, "viele-link"), { recursive: true, force: true });
  });

  it("prüft Sicherungen vor der Wiederherstellung", async () => {
    const foreign = path.join(data, "foreign.db");
    const f = new Database(foreign);
    f.exec(`CREATE TABLE x (a)`);
    f.close();
    assert.equal(await codeOf(() => validateDatabase(foreign)), "notBackup");

    const garbage = path.join(data, "garbage.db");
    writeFileSync(garbage, "das ist keine datenbank");
    assert.equal(await codeOf(() => validateDatabase(garbage)), "corrupt");

    const newer = path.join(data, "newer.db");
    await runMigrations(newer);
    const n = new Database(newer);
    n.exec(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('x','y',CURRENT_TIMESTAMP,'29990101000000_zukunft',1)`);
    n.close();
    assert.equal(await codeOf(() => validateDatabase(newer)), "newer");
    assert.equal(await codeOf(() => validateDatabase(dbFile)), null);
  });

  it("bereitet die Wiederherstellung vor: sichert den Ist-Stand, stellt Datenbank und Dateien bereit, merkt vor", async () => {
    await stageRestore(manual);
    assert.deepEqual(readPending() && { from: readPending()!.from, files: readPending()!.files }, { from: manual, files: true });
    assert.ok(listBackups().some((b) => b.kind === "pre-restore"));

    const staged = path.join(data, "restore", "pending.db");
    assert.equal(existsSync(`${staged}-wal`), false);
    assert.equal(existsSync(`${staged}-shm`), false);
    const peek = new Database(staged, { readonly: true });
    assert.equal(peek.pragma("journal_mode", { simple: true }), "delete");
    peek.close();
    assert.equal(readFileSync(path.join(data, "restore", "pending-files", "rechnungen", "2026", "eingang", "2026-01-05_Lieferant_RE-1.pdf"), "utf8"), "BELEG EINS");

    // Der Launcher tauscht: danach ist der gesicherte Beleg wieder da (er war inzwischen gelöscht)
    assert.ok(applyPendingRestore(dbFile));
    assert.equal(readFileSync(resolveRel("rechnungen/2026/eingang/2026-01-05_Lieferant_RE-1.pdf"), "utf8"), "BELEG EINS");
    const db = new Database(dbFile, { readonly: true });
    assert.equal((db.prepare(`SELECT name FROM "Workshop"`).get() as { name: string }).name, "Meine Firma");
    db.close();
  });

  it("verweigert unbekannte oder beschädigte Sicherungen und hinterlässt nichts Vorgemerktes", async () => {
    assert.equal(await codeOf(() => stageRestore("schrauberos-20200101T000000Z-auto")), "notFound");
    const bad = path.join(backupsDir(), "schrauberos-20200102T000000Z-manual");
    mkdirSync(bad, { recursive: true });
    writeFileSync(path.join(bad, "database.db.gz"), gzipSync(Buffer.from("kein sqlite")));
    assert.equal(await codeOf(() => stageRestore("schrauberos-20200102T000000Z-manual")), "corrupt");
    assert.equal(readPending(), null);
    assert.equal(existsSync(path.join(data, "restore", "pending-files")), false);
  });

  it("Archiv-Rundlauf: Herunterladen (tar) und wieder Hochladen ergibt eine gleichwertige Sicherung", async () => {
    const tarFile = path.join(data, "download.tar");
    tar.c({ file: tarFile, cwd: backupPath(manual)!, sync: true, portable: true }, ["."]);
    const name = await importBackupFile(tarFile);
    assert.match(name, /-upload$/);
    assert.equal(existsSync(tarFile), false);
    const imported = listBackups().find((b) => b.name === name)!;
    assert.equal(imported.fileCount, 1);
    assert.equal(readFileSync(path.join(backupPath(name)!, "files", "rechnungen", "2026", "eingang", "2026-01-05_Lieferant_RE-1.pdf"), "utf8"), "BELEG EINS");
  });

  it("nimmt auch .tar.gz und reine Datenbanken (roh/gzip, dann ohne Dateien) an", async () => {
    const tgz = path.join(data, "download.tar.gz");
    tar.c({ file: tgz, cwd: backupPath(manual)!, sync: true, gzip: true, portable: true }, ["."]);
    assert.match(await importBackupFile(tgz), /-upload$/);

    const raw = path.join(data, "raw.db");
    writeFileSync(raw, readDatabaseArchive(manual));
    const rawName = await importBackupFile(raw);
    assert.equal(listBackups().find((b) => b.name === rawName)!.fileCount, 0);
    assert.equal(existsSync(path.join(backupPath(rawName)!, "files")), false); // Wiederherstellen lässt Dateien dann unberührt

    const gz = path.join(data, "raw.db.gz");
    writeFileSync(gz, gzipSync(readDatabaseArchive(manual)));
    assert.match(await importBackupFile(gz), /-upload$/);
  });

  it("lehnt Unbrauchbares ab: Müll, fremde Datenbank, Archiv ohne Datenbank, Symlinks im Archiv", async () => {
    const junk = path.join(data, "junk.bin");
    writeFileSync(junk, "kein backup");
    assert.equal(await codeOf(() => importBackupFile(junk)), "notBackup");
    assert.equal(existsSync(junk), false);

    // Archiv ohne database.db.gz
    const empty = path.join(data, "empty-src");
    mkdirSync(path.join(empty, "files"), { recursive: true });
    writeFileSync(path.join(empty, "files", "x.txt"), "x");
    const noDb = path.join(data, "no-db.tar");
    tar.c({ file: noDb, cwd: empty, sync: true, portable: true }, ["."]);
    assert.equal(await codeOf(() => importBackupFile(noDb)), "notBackup");

    // Archiv mit Symlink (könnte auf fremde Dateien zeigen)
    const evil = path.join(data, "evil-src");
    mkdirSync(path.join(evil, "files"), { recursive: true });
    writeFileSync(path.join(evil, "database.db.gz"), readFileSync(path.join(backupPath(manual)!, "database.db.gz")));
    try {
      symlinkSync("/etc/passwd", path.join(evil, "files", "link"));
      const evilTar = path.join(data, "evil.tar");
      tar.c({ file: evilTar, cwd: evil, sync: true, portable: true }, ["."]);
      assert.notEqual(await codeOf(() => importBackupFile(evilTar)), null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; // Windows ohne Symlink-Recht: Fall nicht prüfbar
    }
    assert.equal(lstatSync(backupsDir()).isDirectory(), true);
    // Es bleiben keine Zwischenordner liegen
    assert.deepEqual(
      (await import("node:fs")).readdirSync(backupsDir()).filter((n) => n.startsWith(".import-")),
      [],
    );
  });

  it("filesDir liegt im Datenverzeichnis", () => {
    assert.equal(filesDir(), path.join(data, "files"));
  });
});
