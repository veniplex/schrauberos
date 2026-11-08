import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chmod, copyFile, link, lstat, mkdir, readFile, readdir, rename, rm, stat as statFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Semaphore } from "@/lib/semaphore";
import { dataDir, readMeta } from "@/lib/updates/store";
import { databaseFile } from "@/server/db-client";
import { appliedMigrations } from "@/server/migrate";
import { BACKUP_KINDS, type BackupKind } from "./kinds";
import type { BackupRetention } from "./settings";
import { filesDir } from "@/server/files";

/**
 * Backups: ein Ordner `<Datenverzeichnis>/backups/schrauberos-<Zeitpunkt>-<Art>/` mit
 *   - `database.db.gz`  konsistenter, geprüfter Schnappschuss der SQLite-Datenbank (Online-Backup, ohne die Anwendung anzuhalten)
 *   - `files/`          Hardlinks auf alle Dateien (Belege, Bilder) zum Zeitpunkt des Backups
 *   - `info.json`       Anzahl und Größe der Dateien
 * Dateien werden nie überschrieben oder verändert, deshalb genügen Hardlinks: Ein Backup kostet nur Platz für die Datenbank und
 * für Dateien, die es später nicht mehr im Live-Bestand gibt. Löscht man ein Backup, verschwinden nur seine Verweise.
 */

export { BACKUP_KINDS, type BackupKind };

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

/** Wie viele Dateien gleichzeitig verlinkt bzw. geprüft werden (die Arbeit läuft im Threadpool, der Event-Loop bleibt frei). */
const BATCH = 64;

/** Alle Dateizugriffe der Baum-Läufe zusammen (über alle Verzeichnisebenen hinweg): verhindert `EMFILE`, wenn die Rekursion Stapel in Stapeln erzeugt. */
const fsGate = new Semaphore(BATCH, Number.POSITIVE_INFINITY);
const gated = <T>(task: () => Promise<T>) => fsGate.run(task);

const isGone = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/**
 * Führt `work` für alle Einträge in Stapeln aus und **wartet immer auf alle Aufgaben des Stapels** (auch nach einem Fehler): Es bleiben keine Nachzügler, die nach dem
 * Aufräumen des Aufrufers noch Dateien anlegen (verwaiste `.tmp-*`). Der erste Fehler wird danach weitergereicht, weitere Stapel starten nicht.
 */
async function inBatches<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    const results = await Promise.allSettled(items.slice(i, i + BATCH).map(work));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
  }
}

/**
 * Bildet den Dateibaum `src` unter `dst` mit Hardlinks nach (Kopie, falls das Dateisystem keine Hardlinks erlaubt). Nur normale
 * Dateien; Symlinks, Sonderdateien und versteckte Einträge (z. B. `.tmp`) werden übersprungen. **Asynchron**: Auch bei sehr vielen Dateien blockiert das den
 * Event-Loop der Anwendung nicht (jeder Dateizugriff ist ein asynchroner Aufruf, in Stapeln, insgesamt höchstens 64 gleichzeitig).
 * **Gegen gleichzeitige Änderungen gehärtet**: Verschwindet eine Datei oder ein Ordner zwischen Auflisten und Verlinken (ENOENT), wird er übersprungen – das Backup
 * bildet den Stand ab, den es gesehen hat.
 */
export async function linkTree(src: string, dst: string): Promise<{ count: number; bytes: number }> {
  await mkdir(dst, { recursive: true });
  let count = 0;
  let bytes = 0;
  if (!existsSync(src)) return { count, bytes };
  let listed;
  try {
    listed = await readdir(src, { withFileTypes: true });
  } catch (error) {
    if (isGone(error)) return { count, bytes };
    throw error;
  }
  const entries = listed.filter((entry) => !entry.name.startsWith("."));
  await inBatches(entries, async (entry) => {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    try {
      const info = await gated(() => lstat(from));
      if (info.isDirectory()) {
        const sub = await linkTree(from, to);
        count += sub.count;
        bytes += sub.bytes;
      } else if (info.isFile()) {
        await gated(async () => {
          try {
            await link(from, to);
          } catch (error) {
            if (isGone(error)) throw error;
            await copyFile(from, to);
          }
        });
        count += 1;
        bytes += info.size;
      }
    } catch (error) {
      if (!isGone(error)) throw error;
    }
  });
  return { count, bytes };
}

/** Alle regulären Dateien eines Baums zählen (für importierte Backups). */
export async function countTree(dir: string): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  if (!existsSync(dir)) return { count, bytes };
  await inBatches(await readdir(dir, { withFileTypes: true }), async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await countTree(full);
      count += sub.count;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      count += 1;
      bytes += (await lstat(full)).size;
    }
  });
  return { count, bytes };
}

/** Wirft, wenn ein ausgepackter Baum etwas anderes als Ordner und normale Dateien enthält (Symlinks, Geräte …). */
export async function assertPlainTree(dir: string): Promise<void> {
  await inBatches(await readdir(dir, { withFileTypes: true }), async (entry) => {
    const full = path.join(dir, entry.name);
    const stat = await lstat(full);
    if (stat.isDirectory()) await assertPlainTree(full);
    else if (!stat.isFile()) throw new Error(`Unzulässiger Eintrag im Backup: ${entry.name}`);
  });
}

/**
 * Format der Sicherung (`info.json`): `format` zählt hoch, wenn sich Aufbau oder Bedeutung der Dateien ändern (Version 1: `database.db.gz` + `files/`); `app` ist die Version des Programms, das sie angelegt
 * hat, `migrations` die Namen der Migrationen im Schnappschuss. Beides ist nur Auskunft (der Name des Ordners und `database.db.gz` bleiben das eigentliche Format); ältere Leser ignorieren unbekannte Felder.
 */
export const BACKUP_FORMAT = 1;

export function writeInfo(dir: string, info: { files: number; bytes: number; migrations?: string[] }): void {
  writeFileSync(path.join(dir, "info.json"), JSON.stringify({ format: BACKUP_FORMAT, app: readMeta(process.cwd())?.version ?? "dev", ...info }));
}

async function readInfo(dir: string): Promise<{ files: number; bytes: number }> {
  try {
    const raw = JSON.parse(await readFile(path.join(dir, "info.json"), "utf8")) as { files?: unknown; bytes?: unknown };
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
  const release = markTempActive(tmp);
  try {
    const rawDb = path.join(tmp, "database.db");
    const source = new Database(dbFile, { fileMustExist: true });
    try {
      await source.backup(rawDb);
    } finally {
      source.close();
    }
    if (!checkDatabaseFile(rawDb)) throw new Error("Der Schnappschuss der Datenbank ist beschädigt.");
    const migrations = appliedMigrations(rawDb);
    await gzipFile(rawDb, path.join(tmp, DB_ARCHIVE));
    for (const f of [rawDb, `${rawDb}-wal`, `${rawDb}-shm`]) rmSync(f, { force: true });

    const linked = await linkTree(filesDir(), path.join(/*turbopackIgnore: true*/ tmp, "files"));
    writeInfo(tmp, { files: linked.count, bytes: linked.bytes, migrations });
    renameSync(tmp, path.join(root, name));
  } catch (error) {
    await removeTree(tmp).catch(() => undefined);
    throw error;
  } finally {
    release();
  }
  return (await readBackup(name))!;
}

async function readBackup(name: string): Promise<BackupInfo | null> {
  const parsed = parseName(name);
  const dir = backupPath(name);
  if (!parsed || !dir) return null;
  let archive;
  try {
    archive = await statFile(path.join(dir, DB_ARCHIVE));
  } catch {
    return null;
  }
  const info = await readInfo(dir);
  return { name, kind: parsed.kind, createdAt: parsed.createdAt, size: archive.size, fileCount: info.files, fileBytes: info.bytes };
}

/** Alle Sicherungen, neueste zuerst. Asynchron (wird bei jedem Aufruf des Dashboards und der Backup-Seite gebraucht). */
export async function listBackups(): Promise<BackupInfo[]> {
  const root = backupsDir();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const infos = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => readBackup(e.name)));
  return infos.filter((info): info is BackupInfo => info !== null).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Ordner, an denen gerade gearbeitet wird (Zwischenordner laufender Backups/Importe/Uploads): Das Aufräumen fasst sie nie an, egal wie alt sie aussehen. */
const activeTemp = new Set<string>();

/** Vermerkt einen Zwischenordner als in Arbeit; die Rückgabe hebt den Vermerk auf (immer in `finally` aufrufen). */
export function markTempActive(dir: string): () => void {
  const resolved = path.resolve(dir);
  activeTemp.add(resolved);
  return () => void activeTemp.delete(resolved);
}

/**
 * Löscht einen Ordnerbaum, ohne den Event-Loop zu blockieren und ohne Rechte-Hürden: Ein entpacktes Archiv kann Ordner ohne Schreibrecht enthalten (Modus 000
 * bei `noChmod`), die sich sonst nicht löschen lassen (EACCES). Erst werden die Rechte der Ordner auf `u+rwx` gesetzt (nur Besitzer, nur dieser Baum), dann
 * wird asynchron gelöscht. Ein Backup mit sehr vielen Hardlinks wird so in vielen kleinen asynchronen Schritten abgebaut.
 */
export async function removeTree(dir: string): Promise<void> {
  await makeWritable(dir);
  await rm(dir, { recursive: true, force: true, maxRetries: 2 });
}

async function makeWritable(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    if (code !== "EACCES" && code !== "EPERM") throw error;
    await chmod(dir, 0o700);
    return makeWritable(dir);
  }
  await chmod(dir, 0o700).catch(() => undefined);
  await inBatches(
    entries.filter((e) => e.isDirectory()),
    (e) => makeWritable(path.join(dir, e.name)),
  );
}

/**
 * Löscht eine Sicherung: Der Ordner wird zuerst **atomar umbenannt** (`.trash-…`, sofort aus der Liste und ohne halb gelöschten Zustand), danach asynchron abgebaut.
 * Bricht der Prozess dazwischen ab, räumt `cleanupBackupTemp` den Rest auf.
 */
export async function deleteBackup(name: string): Promise<boolean> {
  const dir = backupPath(name);
  if (!dir || !existsSync(dir)) return false;
  const trash = path.join(backupsDir(), `.trash-${randomBytes(6).toString("hex")}`);
  const release = markTempActive(trash);
  try {
    try {
      await rename(dir, trash);
    } catch (error) {
      if (isGone(error)) return false;
      throw error;
    }
    await removeTree(trash);
    return true;
  } finally {
    release();
  }
}

const DAY_MS = 86_400_000;

/**
 * Wendet die Aufbewahrung je Art an (Einstellungen → Backups): Von jeder Art bleiben höchstens die neuesten `keep` und keines, das älter als `days` Tage ist
 * (0 = unbegrenzt). Das neueste Backup überhaupt bleibt immer – es gibt nie „kein Backup“ durch die Aufbewahrung. Liefert die gelöschten Namen. Ein Backup, das sich nicht
 * löschen lässt, bricht die übrigen nicht ab: Der erste Fehler wird nach dem Durchlauf geworfen (`error.removed` nennt, was gelöscht wurde).
 */
export async function pruneBackups(retention: BackupRetention, now = new Date()): Promise<string[]> {
  const all = await listBackups(); // neueste zuerst
  const newest = all[0]?.name;
  const doomed: string[] = [];
  for (const kind of BACKUP_KINDS) {
    const rule = retention[kind];
    all
      .filter((b) => b.kind === kind)
      .forEach((b, index) => {
        const tooMany = rule.keep > 0 && index >= rule.keep;
        const tooOld = rule.days > 0 && now.getTime() - b.createdAt.getTime() > rule.days * DAY_MS;
        if ((tooMany || tooOld) && b.name !== newest) doomed.push(b.name);
      });
  }
  const removed: string[] = [];
  let firstError: unknown;
  for (const name of doomed) {
    try {
      if (await deleteBackup(name)) removed.push(name);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw new PruneError(removed, doomed.length, firstError);
  return removed;
}

/** Aufbewahrung nur teilweise gelungen: `removed` sind die gelöschten Backups. */
export class PruneError extends Error {
  constructor(
    readonly removed: string[],
    total: number,
    cause: unknown,
  ) {
    super(`Aufbewahrung: ${total - removed.length} von ${total} Backups konnten nicht gelöscht werden`, { cause });
  }
}

/** Zwischenordner (`.tmp-`, `.import-`, `.upload-`, `.trash-`), die weniger alt sind, werden nie angefasst (Sicherheitsabstand zu laufenden Vorgängen). */
export const TEMP_MIN_AGE_MS = 6 * 3_600_000;

/**
 * Räumt liegengebliebene Zwischenordner (abgebrochene Backups/Importe/Löschungen) auf. Ein Eintrag wird nur entfernt, wenn **dieser Prozess nicht daran arbeitet**
 * (`markTempActive`; es läuft nur ein Prozess) **und** er mindestens `minAgeMs` unverändert ist. Die Änderungszeit eines Ordners ändert sich nur, wenn direkt
 * darin etwas angelegt wird – ein langer Import schreibt tiefer –, deshalb allein reicht sie nicht. Liefert die Zahl der entfernten Einträge.
 */
export async function cleanupBackupTemp(now = Date.now(), minAgeMs = TEMP_MIN_AGE_MS): Promise<number> {
  const root = backupsDir();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const e of entries) {
    if (!e.name.startsWith(".")) continue;
    const full = path.join(root, e.name);
    if (activeTemp.has(path.resolve(full))) continue;
    try {
      if (now - (await statFile(full)).mtimeMs <= minAgeMs) continue;
      await removeTree(full);
      removed++;
    } catch {
      /* nicht löschbar: der nächste Lauf versucht es wieder */
    }
  }
  return removed;
}
