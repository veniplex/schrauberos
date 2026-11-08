import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as tar from "tar";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { after, describe, it, mock } from "node:test";
import { gzipSync } from "node:zlib";
import { DISK_RESERVE_BYTES, setFreeBytesForTest } from "@/lib/disk";
import { rawTar, type RawEntry } from "@/test/tar";
import { applyPendingRestore, readPending } from "@/lib/updates/restore";
import { runMigrations } from "@/server/migrate";
import { filesDir, resolveRel, storeFile } from "@/server/files";
import { BACKUP_KINDS, backupPath, backupsDir, cleanupBackupTemp, createBackup, deleteBackup, isBackupName, linkTree, listBackups, markTempActive, PruneError, pruneBackups, removeTree, TEMP_MIN_AGE_MS } from "./core";
import { readDatabaseArchive } from "@/test/backup-archive";
import { gunzipDatabase, importBackupFile, RestoreError, stageRestore, validateDatabase } from "./restore";

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
    // Z7: info.json nennt Format, Programmversion und Migrationen (Auskunft für künftige Leser; ältere Leser ignorieren unbekannte Felder)
    const meta = JSON.parse(readFileSync(path.join(backupPath(info.name)!, "info.json"), "utf8")) as { format: number; app: string; files: number; bytes: number; migrations: string[] };
    assert.deepEqual([meta.format, typeof meta.app, meta.files, meta.bytes], [1, "string", 1, 10]);
    assert.ok(meta.migrations.includes("00000000000000_baseline"));

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

  it("akzeptiert nur feste Namen (kein Pfad-Trick)", async () => {
    assert.equal(isBackupName("schrauberos-20260101T020000Z-auto"), true);
    for (const bad of ["../x", "schrauberos-20260101T020000Z-auto/../../etc", "x", "schrauberos-1-auto", "schrauberos-20260101T020000Z-auto.db.gz"]) {
      assert.equal(isBackupName(bad), false);
      assert.equal(backupPath(bad), null);
    }
    assert.equal(await deleteBackup("../../etc"), false);
  });

  it("behält von den automatischen Sicherungen nur die neuesten", async () => {
    for (let i = 1; i <= 4; i++) await createBackup("auto", dbFile, new Date(Date.UTC(2026, 0, i, 2, 0, 0)));
    assert.equal((await pruneBackups({ ...UNLIMITED, auto: { keep: 2, days: 0 } }, new Date("2026-01-05T00:00:00Z"))).length, 2);
    assert.deepEqual((await listBackups()).filter((b) => b.kind === "auto").map((b) => b.createdAt.getUTCDate()), [4, 3]);
    assert.ok((await listBackups()).some((b) => b.kind === "manual"));
  });

  it("Aufbewahrung je Art: Anzahl und Alter gelten getrennt; 0 = unbegrenzt; das neueste Backup überhaupt bleibt immer", async (t) => {
    // eigenes Datenverzeichnis: die übrigen Tests dieser Datei brauchen ihre Sicherungen; t.after stellt es auch nach einem fehlgeschlagenen Test wieder her
    const isolated = mkdtempSync(path.join(tmpdir(), "so-retention-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = isolated;
    t.after(() => {
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      rmSync(isolated, { recursive: true, force: true });
    });
    const at = (day: number) => new Date(Date.UTC(2026, 2, day, 2, 0, 0));
    for (const day of [1, 2, 3]) await createBackup("pre-update", dbFile, at(day));
    for (const day of [1, 2]) await createBackup("manual", dbFile, at(day));
    await createBackup("auto", dbFile, at(2));
    const now = new Date("2026-03-20T00:00:00Z");
    const kept = async () => (await listBackups()).map((b) => `${b.kind}:${b.createdAt.getUTCDate()}`).sort();

    // nur Anzahl: von „vor Update“ die zwei neuesten
    await pruneBackups({ ...UNLIMITED, "pre-update": { keep: 2, days: 0 } }, now);
    assert.deepEqual(await kept(), ["auto:2", "manual:1", "manual:2", "pre-update:2", "pre-update:3"]);
    // nur Alter: manuelle höchstens 18 Tage (am 20.3.: der vom 1.3. ist 19 Tage alt, der vom 2.3. 18)
    await pruneBackups({ ...UNLIMITED, manual: { keep: 0, days: 18 } }, now);
    assert.deepEqual(await kept(), ["auto:2", "manual:2", "pre-update:2", "pre-update:3"]);
    // alles zu alt: das neueste Backup überhaupt (pre-update vom 3.3.) bleibt trotzdem
    const doomed = await pruneBackups({ ...Object.fromEntries(BACKUP_KINDS.map((k) => [k, { keep: 0, days: 1 }])) } as typeof UNLIMITED, now);
    assert.equal(doomed.length, 3);
    assert.deepEqual(await kept(), ["pre-update:3"]);
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
    assert.ok((await listBackups()).some((b) => b.kind === "pre-restore"));

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
    const imported = (await listBackups()).find((b) => b.name === name)!;
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
    assert.equal((await listBackups()).find((b) => b.name === rawName)!.fileCount, 0);
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

  it("Archive mit Hardlink, ..-Pfad, zu vielen Einträgen oder zu großem Inhalt werden abgelehnt – ohne Reste (SEC-14)", async () => {
    const dbGz = readFileSync(path.join(backupPath(manual)!, "database.db.gz"));
    const archive = (name: string, entries: RawEntry[]) => {
      const file = path.join(data, name);
      writeFileSync(file, rawTar([{ name: "database.db.gz", data: dbGz }, ...entries]));
      return file;
    };
    const outside = path.join(data, "draussen.txt");
    const uploadsBefore = (await listBackups()).filter((b) => b.kind === "upload").length;

    assert.equal(await codeOf(() => importBackupFile(archive("hart.tar", [{ name: "files/hart", type: "1", linkname: "../database.db.gz" }]))), "notBackup", "Hardlink");
    assert.equal(await codeOf(() => importBackupFile(archive("punkte.tar", [{ name: "files/../../draussen.txt", data: "böse" }]))), "notBackup", "..-Pfad");
    assert.equal(await codeOf(() => importBackupFile(archive("geraet.tar", [{ name: "files/dev", type: "3" }]))), "notBackup", "Geräte-Datei");
    assert.equal(existsSync(outside), false);

    // Grenzen für Einträge und Größe (hier klein, damit die Archive klein bleiben)
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `files/f${i}.txt`, data: "x" }));
    assert.equal(await codeOf(() => importBackupFile(archive("viele.tar", many), { maxEntries: 5, maxBytes: 1e9 })), "tooLarge", "zu viele Einträge");
    assert.equal(await codeOf(() => importBackupFile(archive("gross.tar", [{ name: "files/gross.bin", data: Buffer.alloc(5000) }]), { maxEntries: 100, maxBytes: dbGz.length + 1000 })), "tooLarge", "zu große Gesamtgröße");
    setFreeBytesForTest(async () => 4 * 1024 ** 4);
    try {
      assert.equal(await codeOf(() => importBackupFile(archive("riesig.tar", [{ name: "files/riesig.bin", declaredSize: 300 * 1024 ** 3, data: "kurz" }]))), "tooLarge", "riesig angekündigt (über der Standardgrenze)");
    } finally {
      setFreeBytesForTest(null);
    }

    // reicht der freie Platz nicht, heißt der Fehler „diskFull“
    setFreeBytesForTest(async () => DISK_RESERVE_BYTES + 100);
    try {
      assert.equal(await codeOf(() => importBackupFile(archive("platz.tar", [{ name: "files/a.bin", data: Buffer.alloc(5000) }]))), "diskFull");
    } finally {
      setFreeBytesForTest(null);
    }

    assert.deepEqual(readdirSync(backupsDir()).filter((n) => n.startsWith(".import-") || n.startsWith(".upload-")), [], "keine Zwischenordner");
    assert.equal((await listBackups()).filter((b) => b.kind === "upload").length, uploadsBefore, "nichts wurde als Sicherung übernommen");
  });

  it("filesDir liegt im Datenverzeichnis", () => {
    assert.equal(filesDir(), path.join(data, "files"));
  });
});

describe("Gzip-Bombe (ZP3-S-F1)", () => {
  /** Winzige gzip-Datei, die sich zu `megabytes` MiB Nullen entpackt (mit SQLite-Kennung am Anfang, damit sie als Datenbank durchgeht). */
  const bomb = (megabytes: number) => gzipSync(Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(megabytes * 1024 * 1024)]), { level: 9 });

  it("gunzipDatabase bricht ab, sobald die Obergrenze überschritten ist (tooLarge) und löscht die halbe Datei", async () => {
    const gz = path.join(data, "bombe.db.gz");
    writeFileSync(gz, bomb(20));
    assert.ok(statSync(gz).size < 100 * 1024, "klein verpackt");
    const dest = path.join(data, "bombe.db");
    assert.equal(await codeOf(() => gunzipDatabase(gz, dest, 1024 * 1024)), "tooLarge");
    assert.equal(existsSync(dest), false, "keine halbe Datei");
    // innerhalb der Grenze: entpackt
    writeFileSync(gz, bomb(1));
    await gunzipDatabase(gz, dest, 4 * 1024 * 1024);
    assert.equal(statSync(dest).size, 1024 * 1024 + 16);
    rmSync(dest);
    // kaputtes gzip bleibt „corrupt“
    writeFileSync(gz, "kein gzip");
    assert.equal(await codeOf(() => gunzipDatabase(gz, dest)), "corrupt");
    assert.equal(existsSync(dest), false);
  });

  it("die Grenze folgt dem freien Platz: reicht er nicht, heißt der Fehler diskFull (stageRestore und Import), und es bleibt nichts liegen", async () => {
    const name = "schrauberos-20200103T000000Z-manual";
    const dir = path.join(backupsDir(), name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "database.db.gz"), bomb(20));
    setFreeBytesForTest(async () => DISK_RESERVE_BYTES + 1024 * 1024); // nach Abzug der Reserve bleibt 1 MiB
    try {
      assert.equal(await codeOf(() => stageRestore(name)), "diskFull");
      assert.equal(readPending(), null);
      assert.equal(existsSync(path.join(data, "restore", "pending.db")), false, "die halbe Datenbank ist weg");

      // Upload als .db.gz: gleiche Grenze, kein Zwischenordner bleibt
      const upload = path.join(data, "bombe-upload.db.gz");
      writeFileSync(upload, bomb(20));
      assert.equal(await codeOf(() => importBackupFile(upload)), "diskFull");
      assert.equal(existsSync(upload), false);
      assert.deepEqual(readdirSync(backupsDir()).filter((n) => n.startsWith(".import-")), []);
    } finally {
      setFreeBytesForTest(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Backups: Dateibäume, Löschen, Aufräumen (ZP3-A-4/A-5, S-F7)", () => {
  const stubs: unknown[] = [];
  const restoreStubs = () => (mock.restoreAll(), void (stubs.length = 0));
  const makeTree = (root: string, dirs: number, files: number) => {
    for (let d = 0; d < dirs; d++) {
      mkdirSync(path.join(root, `d${d}`), { recursive: true });
      for (let i = 0; i < files; i++) writeFileSync(path.join(root, `d${d}`, `f${i}.txt`), `${d}-${i}`);
    }
  };

  it("linkTree: verschwindet eine Datei zwischen Auflisten und Verlinken (ENOENT), wird sie übersprungen – das Backup scheitert nicht", async () => {
    const src = path.join(data, "race-src");
    makeTree(src, 3, 10);
    const lstatOriginal = fsp.lstat;
    const linkOriginal = fsp.link;
    // d0/f1: weg, bevor lstat sie ansieht; d1/f2: weg, bevor link sie verlinkt
    stubs.push(
      mock.method(fsp, "lstat", async (p: string, ...rest: unknown[]) => {
        if (String(p).endsWith(path.join("d0", "f1.txt"))) rmSync(p, { force: true });
        return (lstatOriginal as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
      }),
      mock.method(fsp, "link", async (from: string, to: string) => {
        if (String(from).endsWith(path.join("d1", "f2.txt"))) rmSync(from, { force: true });
        return linkOriginal(from, to);
      }),
    );
    try {
      const result = await linkTree(src, path.join(data, "race-dst"));
      assert.equal(result.count, 28, "30 Dateien, zwei verschwanden");
      assert.equal(existsSync(path.join(data, "race-dst", "d0", "f1.txt")), false);
      assert.equal(readFileSync(path.join(data, "race-dst", "d2", "f9.txt"), "utf8"), "2-9");
    } finally {
      restoreStubs();
      rmSync(src, { recursive: true, force: true });
      rmSync(path.join(data, "race-dst"), { recursive: true, force: true });
    }
  });

  it("scheitert linkTree mitten im Baum (kein ENOENT), räumt createBackup auf: es bleibt kein .tmp-* liegen, auch nicht durch Nachzügler", async () => {
    const files = filesDir();
    makeTree(files, 5, 40);
    const linkOriginal = fsp.link;
    stubs.push(
      mock.method(fsp, "link", async (from: string, to: string) => {
        if (String(from).endsWith(path.join("d2", "f20.txt"))) throw Object.assign(new Error("E/A-Fehler"), { code: "EIO" });
        return linkOriginal(from, to);
      }),
      mock.method(fsp, "copyFile", async () => {
        throw Object.assign(new Error("E/A-Fehler"), { code: "EIO" });
      }),
    );
    try {
      await assert.rejects(createBackup("manual", dbFile));
    } finally {
      restoreStubs();
    }
    // Nachzügler hätten den Baum nach dem Aufräumen neu angelegt: lange genug dem Event-Loop Zeit geben
    for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(readdirSync(backupsDir()).filter((n) => n.startsWith(".tmp-")), [], "kein verwaistes .tmp-*");
    rmSync(path.join(files, "d0"), { recursive: true, force: true });
    for (let d = 1; d < 5; d++) rmSync(path.join(files, `d${d}`), { recursive: true, force: true });
  });

  it("nie mehr als 64 Dateizugriffe gleichzeitig, auch bei tiefer Verschachtelung (kein EMFILE)", async () => {
    const src = path.join(data, "tief");
    makeTree(src, 20, 20); // 20 Ordner × 20 Dateien: ohne globale Grenze liefen bis zu 20 × 20 Zugriffe gleichzeitig
    let running = 0;
    let peak = 0;
    const originalLink = fsp.link;
    stubs.push(
      mock.method(fsp, "link", async (from: string, to: string) => {
        running++;
        peak = Math.max(peak, running);
        try {
          await new Promise((r) => setImmediate(r));
          return await originalLink(from, to);
        } finally {
          running--;
        }
      }),
    );
    try {
      assert.equal((await linkTree(src, path.join(data, "tief-link"))).count, 400);
      assert.ok(peak <= 64 && peak > 1, `gleichzeitig: ${peak}`);
    } finally {
      restoreStubs();
      rmSync(src, { recursive: true, force: true });
      rmSync(path.join(data, "tief-link"), { recursive: true, force: true });
    }
  });

  it("deleteBackup löscht asynchron (Event-Loop läuft weiter), atomar (erst umbenannt) und lässt Hardlink-Partner unberührt", async () => {
    const files = filesDir();
    makeTree(files, 10, 100);
    const a = await createBackup("manual", dbFile, new Date(Date.UTC(2030, 0, 1)));
    const b = await createBackup("manual", dbFile, new Date(Date.UTC(2030, 0, 2)));
    assert.ok(a.fileCount >= 1000);
    const live = path.join(files, "d3", "f7.txt");
    assert.equal(statSync(path.join(backupPath(a.name)!, "files", "d3", "f7.txt")).ino, statSync(live).ino, "Hardlink auf denselben Inode");

    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    assert.equal(await deleteBackup(a.name), true);
    clearInterval(timer);
    assert.ok(ticks > 0, "zwischendurch kam der Event-Loop zum Zug");
    assert.equal(existsSync(backupPath(a.name)!), false);
    assert.deepEqual(readdirSync(backupsDir()).filter((n) => n.startsWith(".trash-")), [], "nichts bleibt liegen");
    // Das andere Backup und der Live-Bestand teilen die Inodes und sind unversehrt
    assert.equal(readFileSync(path.join(backupPath(b.name)!, "files", "d3", "f7.txt"), "utf8"), "3-7");
    assert.equal(readFileSync(live, "utf8"), "3-7");
    assert.equal(await deleteBackup(a.name), false, "zweites Löschen: gibt es nicht mehr");
    await deleteBackup(b.name);
    assert.equal(readFileSync(live, "utf8"), "3-7", "Löschen eines Backups lässt die Live-Dateien stehen");
    for (let d = 0; d < 10; d++) rmSync(path.join(files, `d${d}`), { recursive: true, force: true });
  });

  it("removeTree löscht auch Ordner ohne Schreibrecht (Modus aus einem Archiv, ZP3-S-F7)", async () => {
    const tree = path.join(data, "modus");
    mkdirSync(path.join(tree, "gesperrt", "tief"), { recursive: true });
    writeFileSync(path.join(tree, "gesperrt", "tief", "x.txt"), "x");
    chmodSync(path.join(tree, "gesperrt", "tief"), 0o000);
    chmodSync(path.join(tree, "gesperrt"), 0o000);
    await removeTree(tree);
    assert.equal(existsSync(tree), false);
  });

  it("pruneBackups: scheitert ein Backup beim Löschen, werden die übrigen trotzdem gelöscht; der Fehler nennt, was gelöscht wurde", async () => {
    const isolated = mkdtempSync(path.join(tmpdir(), "so-prune-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = isolated;
    const renameOriginal = fsp.rename;
    try {
      for (const day of [1, 2, 3]) await createBackup("manual", dbFile, new Date(Date.UTC(2031, 0, day)));
      const doomedName = (await listBackups()).find((b) => b.createdAt.getUTCDate() === 2)!.name;
      stubs.push(
        mock.method(fsp, "rename", async (from: string, to: string) => {
          if (String(from).endsWith(doomedName)) throw Object.assign(new Error("gesperrt"), { code: "EBUSY" });
          return renameOriginal(from, to);
        }),
      );
      await assert.rejects(
        pruneBackups({ ...UNLIMITED, manual: { keep: 1, days: 0 } }, new Date("2031-02-01T00:00:00Z")),
        (error: unknown) => error instanceof PruneError && error.removed.length === 1 && !error.removed.includes(doomedName),
      );
      const left = (await listBackups()).map((b) => b.createdAt.getUTCDate()).sort();
      assert.deepEqual(left, [2, 3], "das neueste bleibt, das gesperrte auch, das dritte wurde gelöscht");
    } finally {
      restoreStubs();
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it("cleanupBackupTemp: räumt alte Zwischenordner, lässt aber den in Arbeit befindlichen (auch wenn er alt aussieht) und junge stehen", async () => {
    const root = backupsDir();
    const old = path.join(root, ".import-alt");
    const busy = path.join(root, ".import-laeuft");
    const young = path.join(root, ".tmp-jung");
    const trash = path.join(root, ".trash-rest");
    for (const dir of [old, busy, young, trash]) mkdirSync(path.join(dir, "tief"), { recursive: true });
    writeFileSync(path.join(old, "tief", "x"), "x");
    const release = markTempActive(busy);
    try {
      assert.equal(await cleanupBackupTemp(Date.now(), TEMP_MIN_AGE_MS), 0, "alles ist jünger als die Mindestzeit");
      const later = Date.now() + TEMP_MIN_AGE_MS + 60_000;
      assert.equal(await cleanupBackupTemp(later, TEMP_MIN_AGE_MS), 3);
      assert.equal(existsSync(old), false);
      assert.equal(existsSync(trash), false);
      assert.equal(existsSync(young), false, "alt genug (Uhr vorgestellt) und nicht in Arbeit");
      assert.equal(existsSync(busy), true, "in Arbeit: nie anfassen");
    } finally {
      release();
      rmSync(busy, { recursive: true, force: true });
    }
  });
});
