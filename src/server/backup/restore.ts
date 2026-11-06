import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { constants as zlibConstants, createGunzip, gunzipSync } from "node:zlib";
import { cancelPending, pendingDbFile, pendingFilesDir, restoreDir, writePending } from "@/lib/updates/restore";
import { listMigrations } from "@/server/migrate";
import { assertPlainTree, backupPath, backupsDir, checkDatabaseFile, countTree, createBackup, DB_ARCHIVE, gzipFile, linkTree, uniqueBackupName, writeInfo } from "./core";

export type RestoreErrorCode = "notFound" | "corrupt" | "notBackup" | "newer";

/** Fehler mit festem Code; die Oberfläche übersetzt `backup.errors.<code>`. */
export class RestoreError extends Error {
  constructor(readonly code: RestoreErrorCode) {
    super(code);
  }
}

/** Prüft, ob eine SQLite-Datei eine verwendbare Sicherung dieser Anwendung ist (und nicht von einer neueren Version stammt). */
export function validateDatabase(file: string, migrationsDir?: string): void {
  if (!checkDatabaseFile(file)) throw new RestoreError("corrupt");
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name));
    if (!["_prisma_migrations", "User", "Workshop"].every((t) => tables.has(t))) throw new RestoreError("notBackup");
    const known = new Set(listMigrations(migrationsDir).map((m) => m.name));
    const applied = (db.prepare(`SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).all() as { name: string }[]).map((r) => r.name);
    // Eine Sicherung aus einer neueren Version würde mit dem Schema dieser Version nicht zusammenpassen
    if (applied.some((n) => !known.has(n))) throw new RestoreError("newer");
  } finally {
    db.close();
  }
}

const removeDatabaseFiles = (file: string) => [file, `${file}-wal`, `${file}-shm`].forEach((f) => rmSync(f, { force: true }));

/** Schreibt ausstehende WAL-Daten zurück und stellt auf den Rollback-Journal-Modus um: eine einzelne Datei ohne Nebendateien. */
function makeSelfContained(file: string): void {
  const db = new Database(file, { fileMustExist: true });
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode = DELETE");
  } finally {
    db.close();
  }
  rmSync(`${file}-wal`, { force: true });
  rmSync(`${file}-shm`, { force: true });
}

/** Entpackt einen Datenbank-Schnappschuss (.gz), prüft ihn und macht ihn zu einer einzelnen, in sich geschlossenen Datei. */
async function unpackAndValidate(gzFile: string, dest: string, mode: "keep" | "check"): Promise<void> {
  try {
    await pipeline(createReadStream(gzFile), createGunzip(), createWriteStream(dest));
  } catch {
    removeDatabaseFiles(dest);
    throw new RestoreError("corrupt");
  }
  try {
    validateDatabase(dest);
    if (mode === "keep") makeSelfContained(dest);
    else removeDatabaseFiles(dest);
  } catch (error) {
    removeDatabaseFiles(dest);
    throw error;
  }
}

/**
 * Bereitet die Wiederherstellung einer vorhandenen Sicherung vor: prüfen, aktuellen Stand sichern (pre-restore), Datenbank und
 * Dateien bereitstellen und für den nächsten Start vormerken. Den Neustart und den Austausch übernimmt der Launcher.
 * Enthält die Sicherung keine Dateien (z. B. eine hochgeladene reine Datenbank), bleiben die vorhandenen Dateien unberührt.
 */
export async function stageRestore(name: string): Promise<void> {
  const dir = backupPath(name);
  if (!dir || !existsSync(path.join(dir, DB_ARCHIVE))) throw new RestoreError("notFound");
  mkdirSync(restoreDir(), { recursive: true });
  cancelPending();
  await unpackAndValidate(path.join(dir, DB_ARCHIVE), pendingDbFile(), "keep");
  const hasFiles = existsSync(path.join(dir, "files"));
  try {
    if (hasFiles) await linkTree(path.join(dir, "files"), pendingFilesDir());
    await createBackup("pre-restore");
  } catch (error) {
    cancelPending();
    throw error;
  }
  writePending({ from: name, at: new Date().toISOString(), files: hasFiles });
}

const GZIP = [0x1f, 0x8b];
const SQLITE_MAGIC = "SQLite format 3\0";

type Sniffed = "tar" | "tar.gz" | "db" | "db.gz" | null;

/** Erkennt, was hochgeladen wurde: Backup-Archiv (tar), rohe oder gzip-komprimierte SQLite-Datei. */
function sniff(file: string): Sniffed {
  const fd = openSync(file, "r");
  let head: Buffer;
  try {
    head = Buffer.alloc(64 * 1024);
    head = head.subarray(0, readSync(fd, head, 0, head.length, 0));
  } finally {
    closeSync(fd);
  }
  const kindOf = (b: Buffer, gz: boolean): Sniffed => {
    if (b.subarray(0, 16).toString("latin1") === SQLITE_MAGIC) return gz ? "db.gz" : "db";
    if (b.subarray(257, 262).toString("latin1") === "ustar") return gz ? "tar.gz" : "tar";
    return null;
  };
  if (head[0] === GZIP[0] && head[1] === GZIP[1]) {
    try {
      return kindOf(gunzipSync(head, { finishFlush: zlibConstants.Z_SYNC_FLUSH }), true);
    } catch {
      return null;
    }
  }
  return kindOf(head, false);
}

/**
 * Übernimmt eine hochgeladene Datei als Sicherung `upload` in die Liste: ein Backup-Archiv (von „Herunterladen“) oder – für
 * ältere/fremde Sicherungen – eine reine SQLite-Datei (roh oder .gz; dann ohne Dateien). Die Datei muss auf der Platte liegen;
 * sie wird geprüft und danach gelöscht.
 */
export async function importBackupFile(uploaded: string): Promise<string> {
  const kind = sniff(uploaded);
  if (!kind) {
    rmSync(uploaded, { force: true });
    throw new RestoreError("notBackup");
  }
  const root = backupsDir();
  mkdirSync(root, { recursive: true });
  const work = path.join(root, `.import-${randomBytes(6).toString("hex")}`);
  mkdirSync(work);
  try {
    if (kind === "tar" || kind === "tar.gz") {
      // Nur Ordner und normale Dateien: Symlinks, Hardlinks und Sonderdateien werden abgelehnt
      let unsupported = false;
      try {
        await tar.x({
          file: uploaded,
          cwd: work,
          strict: true,
          noChmod: true,
          filter: (_p, entry) => {
            const type = (entry as tar.ReadEntry).type;
            if (type === "File" || type === "OldFile" || type === "ContiguousFile" || type === "Directory") return true;
            unsupported = true;
            return false;
          },
        });
      } catch {
        throw new RestoreError("corrupt");
      }
      if (unsupported) throw new RestoreError("notBackup");
      await assertPlainTree(work);
      if (!existsSync(path.join(work, DB_ARCHIVE))) throw new RestoreError("notBackup");
    } else {
      const raw = path.join(work, "database.db");
      if (kind === "db.gz") await pipeline(createReadStream(uploaded), createGunzip(), createWriteStream(raw)).catch(() => rmSync(raw, { force: true }));
      else renameSync(uploaded, raw);
      validateDatabase(raw);
      await gzipFile(raw, path.join(work, DB_ARCHIVE));
      removeDatabaseFiles(raw);
    }
    // Die Datenbank im Archiv muss gültig sein
    const probe = path.join(work, "probe.db");
    await unpackAndValidate(path.join(work, DB_ARCHIVE), probe, "check");
    const files = await countTree(path.join(work, "files"));
    writeInfo(work, { files: files.count, bytes: files.bytes });
    const name = uniqueBackupName("upload");
    renameSync(work, path.join(root, name));
    return name;
  } finally {
    rmSync(uploaded, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

/** Inhalt der Datei `database.db.gz` einer Sicherung als Roh-Datenbank (für Tests und Prüfungen). */
export const readDatabaseArchive = (name: string): Buffer => gunzipSync(readFileSync(path.join(backupPath(name)!, DB_ARCHIVE)));
