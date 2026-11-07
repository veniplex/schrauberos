import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants as zlibConstants, createGunzip, gunzipSync } from "node:zlib";
import { ArchiveError, extractArchive, type ArchiveLimits } from "@/lib/archive";
import { DISK_RESERVE_BYTES, freeBytes } from "@/lib/disk";
import { limitStream, StreamLimitError } from "@/lib/limit-stream";
import { OffsiteCryptoError, createDecryptStream, isOffsiteHeader } from "@/lib/offsite/crypto";
import { deriveOffsiteMasterKey, WRAPPED_SETTING_KEY } from "@/lib/secret-wrap";
import { cancelPending, pendingDbFile, pendingFilesDir, restoreDir, writePending, writePendingSecretKey } from "@/lib/updates/restore";
import { listMigrations } from "@/server/migrate";
import { readSecretKey } from "@/server/secrets";
import { assertPlainTree, backupPath, backupsDir, checkDatabaseFile, countTree, createBackup, DB_ARCHIVE, gzipFile, linkTree, markTempActive, removeTree, uniqueBackupName, writeInfo } from "./core";

export type RestoreErrorCode =
  | "notFound"
  | "corrupt"
  | "notBackup"
  | "newer"
  | "tooLarge"
  | "diskFull"
  /** Eingabe des Wiederherstellungsschlüssels fehlerhaft (Länge, Zeichen, Prüfzeichen) */
  | "keyFormat"
  /** Der Wiederherstellungsschlüssel passt nicht zu diesem Backup (oder die Datei ist verändert) */
  | "wrongKey"
  /** Das Backup enthält keine mit einem Wiederherstellungsschlüssel umhüllte Kopie von secret.key (zu alt oder ohne Schlüssel erstellt) */
  | "noWrappedKey"
  /** Verschlüsseltes Off-Site-Backup: der Wiederherstellungsschlüssel fehlt */
  | "keyRequired";

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

/** Größte entpackte Datenbank, die angenommen wird (zusätzlich begrenzt der freie Platz). Eine Werkstatt-Datenbank ist um Größenordnungen kleiner. */
export const DATABASE_MAX_BYTES = 64 * 1024 ** 3;

/**
 * Entpackt eine gzip-komprimierte Datenbank nach `dest` – **mit Obergrenze** (Gzip-Bombe): höchstens `min(DATABASE_MAX_BYTES, freier Platz − Reserve)`, der freie Platz wird
 * laufend nachgeprüft. Zu groß → `tooLarge`/`diskFull`, kaputt → `corrupt`; die halbe Datei wird in jedem Fall gelöscht.
 */
export async function gunzipDatabase(gzFile: string, dest: string, maxBytes = DATABASE_MAX_BYTES): Promise<void> {
  const dir = path.dirname(dest);
  const free = await freeBytes(dir);
  const diskLimit = free === null ? Number.POSITIVE_INFINITY : Math.max(0, free - DISK_RESERVE_BYTES);
  try {
    await pipeline(createReadStream(gzFile), createGunzip(), limitStream({ maxBytes: Math.min(maxBytes, diskLimit), free: () => freeBytes(dir), reserve: DISK_RESERVE_BYTES }), createWriteStream(dest));
  } catch (error) {
    removeDatabaseFiles(dest);
    if (error instanceof StreamLimitError) throw new RestoreError(error.code === "tooLarge" && diskLimit < maxBytes ? "diskFull" : error.code);
    throw new RestoreError("corrupt");
  }
}

/** Entpackt einen Datenbank-Schnappschuss (.gz), prüft ihn und macht ihn zu einer einzelnen, in sich geschlossenen Datei. */
async function unpackAndValidate(gzFile: string, dest: string, mode: "keep" | "check"): Promise<void> {
  await gunzipDatabase(gzFile, dest);
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
export async function stageRestore(name: string, options: { recoveryKey?: string | null } = {}): Promise<{ secretKeyRestored: boolean }> {
  const dir = backupPath(name);
  if (!dir || !existsSync(path.join(dir, DB_ARCHIVE))) throw new RestoreError("notFound");
  mkdirSync(restoreDir(), { recursive: true });
  cancelPending();
  await unpackAndValidate(path.join(dir, DB_ARCHIVE), pendingDbFile(), "keep");
  const hasFiles = existsSync(path.join(dir, "files"));
  let secretKeyRestored = false;
  try {
    // Mit Wiederherstellungsschlüssel: die im Backup mitgelieferte Hülle öffnen – vor allem anderen, damit ein falscher Schlüssel nichts anlegt (kein Sicherungsstand vor der Wiederherstellung)
    const entered = options.recoveryKey?.trim();
    if (entered) {
      const wrapped = readWrappedSecretKey(pendingDbFile());
      if (!wrapped) throw new RestoreError("noWrappedKey");
      const { openWrappedSecretKey } = await import("@/server/recovery-key-input"); // erst bei Bedarf geladen (Drosselung der Anmeldung, `server-only`)
      const opened = await openWrappedSecretKey(entered, wrapped);
      if (!opened.ok) throw new RestoreError(opened.reason === "format" ? "keyFormat" : "wrongKey");
      // Derselbe Schlüssel wie der laufende: nichts auszutauschen (fehlt oder ist die Datei nicht lesbar, wird der Schlüssel des Backups eingesetzt)
      const current = readSecretKey();
      if (current.state !== "readable" || opened.secretKeyHex !== current.hex) {
        writePendingSecretKey(opened.secretKeyHex);
        secretKeyRestored = true;
      }
    }
    if (hasFiles) await linkTree(path.join(dir, "files"), pendingFilesDir());
    await createBackup("pre-restore");
  } catch (error) {
    cancelPending();
    throw error;
  }
  writePending({ from: name, at: new Date().toISOString(), files: hasFiles, ...(secretKeyRestored ? { secretKey: true } : {}) });
  return { secretKeyRestored };
}

/** Die umhüllte Kopie von secret.key aus einer Datenbankdatei (Backup); null, wenn es sie nicht gibt. */
function readWrappedSecretKey(file: string): string | null {
  const database = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (database.prepare(`SELECT value FROM AppSetting WHERE key = ?`).get(WRAPPED_SETTING_KEY) as { value: string } | undefined)?.value ?? null;
  } catch {
    return null;
  } finally {
    database.close();
  }
}

const GZIP = [0x1f, 0x8b];
const SQLITE_MAGIC = "SQLite format 3\0";

type Sniffed = "tar" | "tar.gz" | "db" | "db.gz" | "sobk" | null;

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
  if (isOffsiteHeader(head)) return "sobk";
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

/** Obergrenzen für ein hochgeladenes Backup-Archiv: Zahl der Einträge und entpackte Gesamtgröße (zusätzlich begrenzt der freie Platz). */
export const BACKUP_ARCHIVE_LIMITS: ArchiveLimits = { maxEntries: 500_000, maxBytes: 200 * 1024 ** 3 };

/**
 * Übernimmt eine hochgeladene Datei als Sicherung `upload` in die Liste: ein Backup-Archiv (von „Herunterladen“) oder – für
 * ältere/fremde Sicherungen – eine reine SQLite-Datei (roh oder .gz; dann ohne Dateien). Die Datei muss auf der Platte liegen;
 * sie wird geprüft und danach gelöscht. Archive werden nur mit Ordnern und normalen Dateien, ohne gefährliche Pfade und unter den Grenzen in
 * `limits` (Einträge, Größe, freier Platz) entpackt (`lib/archive.ts`).
 */
export async function importBackupFile(uploaded: string, limits: ArchiveLimits = BACKUP_ARCHIVE_LIMITS, options: { recoveryKey?: string | null } = {}): Promise<string> {
  let kind = sniff(uploaded);
  if (!kind) {
    rmSync(uploaded, { force: true });
    throw new RestoreError("notBackup");
  }
  const root = backupsDir();
  mkdirSync(root, { recursive: true });
  let source = uploaded;
  let decrypted: { file: string; release: () => void } | null = null;
  if (kind === "sobk") {
    // Verschlüsseltes Off-Site-Backup (.sobk): mit dem Wiederherstellungsschlüssel streamend entschlüsseln; danach ist es ein gewöhnliches Archiv
    try {
      decrypted = await decryptUploaded(uploaded, options.recoveryKey, root, limits.maxBytes);
    } catch (error) {
      rmSync(uploaded, { force: true });
      throw error;
    }
    source = decrypted.file;
    kind = sniff(source) === "tar" ? "tar" : null;
    if (!kind) {
      rmSync(uploaded, { force: true });
      rmSync(source, { force: true });
      decrypted.release();
      throw new RestoreError("notBackup");
    }
  }
  const work = path.join(root, `.import-${randomBytes(6).toString("hex")}`);
  mkdirSync(work);
  const release = markTempActive(work);
  try {
    if (kind === "tar" || kind === "tar.gz") {
      const free = await freeBytes(root);
      const diskLimit = free === null ? Number.POSITIVE_INFINITY : Math.max(0, free - DISK_RESERVE_BYTES);
      try {
        await extractArchive(source, work, { ...limits, maxBytes: Math.min(limits.maxBytes, diskLimit) }, { noChmod: true });
      } catch (error) {
        if (!(error instanceof ArchiveError)) throw error;
        if (error.code === "unsupported" || error.code === "unsafePath") throw new RestoreError("notBackup");
        if (error.code === "tooLarge" || error.code === "tooManyEntries") throw new RestoreError(diskLimit < limits.maxBytes && error.code === "tooLarge" ? "diskFull" : "tooLarge");
        throw new RestoreError("corrupt");
      }
      await assertPlainTree(work);
      if (!existsSync(path.join(work, DB_ARCHIVE))) throw new RestoreError("notBackup");
    } else {
      const raw = path.join(work, "database.db");
      if (kind === "db.gz") await gunzipDatabase(uploaded, raw);
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
    if (decrypted) {
      rmSync(decrypted.file, { force: true });
      decrypted.release();
    }
    // Ein entpacktes Archiv kann Ordner ohne Schreibrecht enthalten (noChmod): removeTree stellt die Rechte her, löscht asynchron und überdeckt nie den eigentlichen Fehler
    await removeTree(work).catch(() => undefined);
    release();
  }
}

/**
 * Entschlüsselt ein hochgeladenes `.sobk` in eine Zwischendatei im Backup-Ordner (mit Obergrenze und Platzprüfung wie beim Entpacken). Der Schlüssel wird gedrosselt geprüft
 * (global); `wrongKey` heißt: falscher Schlüssel **oder** Datei verändert (nicht unterscheidbar).
 */
async function decryptUploaded(uploaded: string, recoveryKey: string | null | undefined, root: string, maxBytes: number): Promise<{ file: string; release: () => void }> {
  const entered = recoveryKey?.trim();
  if (!entered) throw new RestoreError("keyRequired");
  const { throttledRecoveryKey } = await import("@/server/recovery-key-input");
  const key = await throttledRecoveryKey(entered);
  if (!key.ok) throw new RestoreError("keyFormat");
  const file = path.join(root, `.decrypt-${randomBytes(6).toString("hex")}`);
  const release = markTempActive(file);
  try {
    await decryptToFile(createReadStream(uploaded), file, deriveOffsiteMasterKey(key.key), root, maxBytes);
  } catch (error) {
    release();
    throw error;
  }
  key.accept();
  return { file, release };
}

/**
 * Entschlüsselt einen `.sobk`-Strom nach `dest` – mit Obergrenze (`maxBytes`, zusätzlich der freie Platz abzüglich Reserve, laufend geprüft). Fehler als `RestoreError`:
 * `wrongKey` (falscher Schlüssel oder verändert), `notBackup` (keine .sobk-Datei), `corrupt` (abgeschnitten), `tooLarge`/`diskFull`. Die halbe Datei wird in jedem Fall gelöscht.
 */
export async function decryptToFile(input: Readable, dest: string, masterKey: Buffer, root: string, maxBytes: number): Promise<void> {
  const free = await freeBytes(root);
  const diskLimit = free === null ? Number.POSITIVE_INFINITY : Math.max(0, free - DISK_RESERVE_BYTES);
  try {
    await pipeline(input, createDecryptStream(masterKey), limitStream({ maxBytes: Math.min(maxBytes, diskLimit), free: () => freeBytes(root), reserve: DISK_RESERVE_BYTES }), createWriteStream(dest));
  } catch (error) {
    rmSync(dest, { force: true });
    if (error instanceof StreamLimitError) throw new RestoreError(error.code === "tooLarge" && diskLimit < maxBytes ? "diskFull" : error.code);
    if (error instanceof OffsiteCryptoError) throw new RestoreError(error.code === "auth" ? "wrongKey" : error.code === "format" ? "notBackup" : "corrupt");
    throw error;
  }
}

/** Inhalt der Datei `database.db.gz` einer Sicherung als Roh-Datenbank (für Tests und Prüfungen). */
export const readDatabaseArchive = (name: string): Buffer => gunzipSync(readFileSync(path.join(backupPath(name)!, DB_ARCHIVE)));
