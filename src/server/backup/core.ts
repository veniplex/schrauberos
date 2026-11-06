import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { copyFileSync, createReadStream, createWriteStream, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { dataDir } from "@/lib/updates/store";
import { databaseFile } from "@/server/db-client";
import { filesDir } from "@/server/files";

/**
 * Backups: ein Ordner `<Datenverzeichnis>/backups/schrauberos-<Zeitpunkt>-<Art>/` mit
 *   - `database.db.gz`  konsistenter, geprüfter Schnappschuss der SQLite-Datenbank (Online-Backup, ohne die Anwendung anzuhalten)
 *   - `files/`          Hardlinks auf alle Dateien (Belege, Bilder) zum Zeitpunkt des Backups
 *   - `info.json`       Anzahl und Größe der Dateien
 * Dateien werden nie überschrieben oder verändert, deshalb genügen Hardlinks: Ein Backup kostet nur Platz für die Datenbank und
 * für Dateien, die es später nicht mehr im Live-Bestand gibt. Löscht man ein Backup, verschwinden nur seine Verweise.
 */

export const BACKUP_KINDS = ["auto", "manual", "pre-update", "pre-restore", "pre-migration", "upload"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export type BackupInfo = {
  name: string;
  kind: BackupKind;
  createdAt: Date;
  /** Größe des Datenbank-Schnappschusses (komprimiert) */
  size: number;
  fileCount: number;
  fileBytes: number;
};

const NAME = /^schrauberos-(\d{8}T\d{6}Z)-(auto|manual|pre-update|pre-restore|pre-migration|upload)$/;

export const backupsDir = () => path.join(dataDir(), "backups");
export const isBackupName = (name: string) => NAME.test(name);
export const DB_ARCHIVE = "database.db.gz";

/** Voller Pfad einer Sicherung; null, wenn der Name nicht dem festen Muster entspricht (Schutz vor Pfad-Tricks). */
export function backupPath(name: string): string | null {
  return isBackupName(name) ? path.join(backupsDir(), name) : null;
}

export const backupName = (kind: BackupKind, at = new Date()) => `schrauberos-${at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${kind}`;

/** Freier Name: Gibt es den Namen in dieser Sekunde schon (z. B. zwei Backups kurz hintereinander), zählt der Zeitstempel weiter. */
export function uniqueBackupName(kind: BackupKind, at = new Date()): string {
  for (let i = 0; ; i++) {
    const name = backupName(kind, new Date(at.getTime() + i * 1000));
    if (!existsSync(path.join(backupsDir(), name))) return name;
  }
}

function parseName(name: string): { createdAt: Date; kind: BackupKind } | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const t = m[1];
  return { createdAt: new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`), kind: m[2] as BackupKind };
}

/** Prüft eine SQLite-Datei auf Beschädigungen (schnelle Prüfung der Struktur). */
export function checkDatabaseFile(file: string): boolean {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    return db.pragma("quick_check", { simple: true }) === "ok";
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** Komprimiert eine Datei nach `target` (über eine Zwischendatei, damit nie eine halbe Datei sichtbar ist). */
export async function gzipFile(source: string, target: string): Promise<void> {
  const partial = `${target}.partial`;
  await pipeline(createReadStream(source), createGzip(), createWriteStream(partial));
  renameSync(partial, target);
}

/**
 * Bildet den Dateibaum `src` unter `dst` mit Hardlinks nach (Kopie, falls das Dateisystem keine Hardlinks erlaubt). Nur normale
 * Dateien; Symlinks, Sonderdateien und versteckte Einträge (z. B. `.tmp`) werden übersprungen.
 */
export function linkTree(src: string, dst: string): { count: number; bytes: number } {
  mkdirSync(dst, { recursive: true });
  let count = 0;
  let bytes = 0;
  if (!existsSync(src)) return { count, bytes };
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    const stat = lstatSync(from);
    if (stat.isDirectory()) {
      const sub = linkTree(from, to);
      count += sub.count;
      bytes += sub.bytes;
    } else if (stat.isFile()) {
      try {
        linkSync(from, to);
      } catch {
        copyFileSync(from, to);
      }
      count += 1;
      bytes += stat.size;
    }
  }
  return { count, bytes };
}

/** Alle regulären Dateien eines Baums zählen (für importierte Backups). */
export function countTree(dir: string): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  if (!existsSync(dir)) return { count, bytes };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countTree(full);
      count += sub.count;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      count += 1;
      bytes += statSync(full).size;
    }
  }
  return { count, bytes };
}

/** Wirft, wenn ein ausgepackter Baum etwas anderes als Ordner und normale Dateien enthält (Symlinks, Geräte …). */
export function assertPlainTree(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const stat = lstatSync(full);
    if (stat.isDirectory()) assertPlainTree(full);
    else if (!stat.isFile()) throw new Error(`Unzulässiger Eintrag im Backup: ${entry.name}`);
  }
}

export function writeInfo(dir: string, info: { files: number; bytes: number }): void {
  writeFileSync(path.join(dir, "info.json"), JSON.stringify(info));
}

function readInfo(dir: string): { files: number; bytes: number } {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, "info.json"), "utf8")) as { files?: unknown; bytes?: unknown };
    if (typeof raw.files === "number" && typeof raw.bytes === "number") return { files: raw.files, bytes: raw.bytes };
  } catch {
    /* fehlende Angaben: unbekannt */
  }
  return { files: 0, bytes: 0 };
}

/** Legt eine Sicherung (Datenbank + Dateien) an. Wirft einen Fehler, wenn der Schnappschuss der Datenbank nicht in Ordnung ist. */
export async function createBackup(kind: BackupKind, dbFile = databaseFile(), at = new Date()): Promise<BackupInfo> {
  const root = backupsDir();
  mkdirSync(root, { recursive: true });
  const name = uniqueBackupName(kind, at);
  const tmp = path.join(root, `.tmp-${randomBytes(6).toString("hex")}`);
  mkdirSync(tmp);
  try {
    const rawDb = path.join(tmp, "database.db");
    const source = new Database(dbFile, { fileMustExist: true });
    try {
      await source.backup(rawDb);
    } finally {
      source.close();
    }
    if (!checkDatabaseFile(rawDb)) throw new Error("Der Schnappschuss der Datenbank ist beschädigt.");
    await gzipFile(rawDb, path.join(tmp, DB_ARCHIVE));
    for (const f of [rawDb, `${rawDb}-wal`, `${rawDb}-shm`]) rmSync(f, { force: true });

    const linked = linkTree(filesDir(), path.join(tmp, "files"));
    writeInfo(tmp, { files: linked.count, bytes: linked.bytes });
    renameSync(tmp, path.join(root, name));
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  return readBackup(name)!;
}

function readBackup(name: string): BackupInfo | null {
  const parsed = parseName(name);
  const dir = backupPath(name);
  if (!parsed || !dir || !existsSync(path.join(dir, DB_ARCHIVE))) return null;
  const info = readInfo(dir);
  return { name, kind: parsed.kind, createdAt: parsed.createdAt, size: statSync(path.join(dir, DB_ARCHIVE)).size, fileCount: info.files, fileBytes: info.bytes };
}

export function listBackups(): BackupInfo[] {
  const root = backupsDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      const info = readBackup(e.name);
      return info ? [info] : [];
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function deleteBackup(name: string): boolean {
  const dir = backupPath(name);
  if (!dir || !existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Behält von den automatischen Sicherungen nur die neuesten `keep`; liefert die gelöschten Namen. */
export function pruneAutomaticBackups(keep: number): string[] {
  const old = listBackups()
    .filter((b) => b.kind === "auto")
    .slice(Math.max(1, keep));
  for (const b of old) deleteBackup(b.name);
  return old.map((b) => b.name);
}

/** Räumt liegengebliebene Zwischenordner (abgebrochene Backups/Importe) auf, die älter als eine Stunde sind. */
export function cleanupBackupTemp(): void {
  const root = backupsDir();
  if (!existsSync(root)) return;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".") && Date.now() - statSync(path.join(root, e.name)).mtimeMs > 3_600_000) rmSync(path.join(root, e.name), { recursive: true, force: true });
  }
}
