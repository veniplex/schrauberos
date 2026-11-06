import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./store";

/**
 * Wiederherstellung einer Datenbank-Sicherung – gemeinsam genutzt von der App (stellt die Wiederherstellung bereit) und vom
 * Launcher (tauscht die Datei vor dem Start aus und fällt zurück, wenn die App danach nicht gesund startet).
 *
 * Ablauf: App legt `restore/pending.db` (+ `restore/pending-files/`, falls die Sicherung Dateien enthält) und `pending.json` an und
 * beendet sich → Launcher verschiebt die laufende Datenbank nach `restore/replaced.db` (und `files/` nach `restore/replaced-files/`),
 * setzt die vorgemerkten ein, startet → bei Erfolg werden die ersetzten gelöscht, sonst kommen sie zurück. Das Ergebnis steht in `restore/result.json` und wird in der Oberfläche angezeigt.
 */

export type PendingRestore = { from: string; at: string; /** Dateien (Belege, Bilder) mit austauschen */ files: boolean };
export type RestoreResult = { at: string; from: string; status: "ok" | "rolled-back"; reason?: string };

export const restoreDir = (data = dataDir()) => path.join(data, "restore");
export const pendingDbFile = (data = dataDir()) => path.join(restoreDir(data), "pending.db");
const pendingInfoFile = (data = dataDir()) => path.join(restoreDir(data), "pending.json");
export const pendingFilesDir = (data = dataDir()) => path.join(restoreDir(data), "pending-files");
const replacedFilesDir = (data = dataDir()) => path.join(restoreDir(data), "replaced-files");
const liveFilesDir = (data = dataDir()) => path.join(data, "files");
const replacedDbFile = (data = dataDir()) => path.join(restoreDir(data), "replaced.db");
const resultFile = (data = dataDir()) => path.join(restoreDir(data), "result.json");

const SUFFIXES = ["-wal", "-shm"] as const;
const sidecars = (file: string) => SUFFIXES.map((s) => `${file}${s}`);

/** Datei samt WAL/SHM verschieben: Noch nicht zurückgeschriebene Änderungen gehören zur Datei und dürfen nicht verloren gehen. */
function moveWithSidecars(from: string, to: string): void {
  for (const f of sidecars(to)) rmSync(f, { force: true });
  renameSync(from, to);
  for (const s of SUFFIXES) if (existsSync(`${from}${s}`)) renameSync(`${from}${s}`, `${to}${s}`);
}

function removeWithSidecars(file: string): void {
  rmSync(file, { force: true });
  for (const f of sidecars(file)) rmSync(f, { force: true });
}

/** Merkt eine bereits entpackte und geprüfte Datenbank als Wiederherstellung für den nächsten Start vor. */
export function writePending(info: PendingRestore, data = dataDir()): void {
  mkdirSync(restoreDir(data), { recursive: true });
  writeFileSync(pendingInfoFile(data), JSON.stringify(info));
}

export function readPending(data = dataDir()): PendingRestore | null {
  try {
    if (!existsSync(pendingDbFile(data))) return null;
    const raw = JSON.parse(readFileSync(pendingInfoFile(data), "utf8")) as Partial<PendingRestore>;
    return typeof raw.from === "string" && typeof raw.at === "string" ? { from: raw.from, at: raw.at, files: raw.files === true } : null;
  } catch {
    return null;
  }
}

export function cancelPending(data = dataDir()): void {
  rmSync(pendingDbFile(data), { force: true });
  for (const f of sidecars(pendingDbFile(data))) rmSync(f, { force: true });
  rmSync(pendingFilesDir(data), { recursive: true, force: true });
  rmSync(pendingInfoFile(data), { force: true });
}

/** Tauscht die Datenbank gegen die vorgemerkte aus. Gibt true zurück, wenn getauscht wurde. */
export function applyPendingRestore(dbFile: string, data = dataDir()): PendingRestore | null {
  const pending = readPending(data);
  if (!pending) return null;
  removeWithSidecars(replacedDbFile(data));
  // Die bisherige Datenbank wandert samt WAL/SHM zur Seite (für den Rückfall); an der neuen Datei darf nichts vom alten WAL hängen
  if (existsSync(dbFile)) moveWithSidecars(dbFile, replacedDbFile(data));
  else for (const f of sidecars(dbFile)) rmSync(f, { force: true });
  moveWithSidecars(pendingDbFile(data), dbFile);
  if (pending.files) {
    // Dateien: bisherige zur Seite, vorgemerkte an ihre Stelle (Hardlinks, daher schnell und ohne zusätzlichen Platz)
    rmSync(replacedFilesDir(data), { recursive: true, force: true });
    if (existsSync(liveFilesDir(data))) renameSync(liveFilesDir(data), replacedFilesDir(data));
    renameSync(pendingFilesDir(data), liveFilesDir(data));
  }
  rmSync(pendingInfoFile(data), { force: true });
  // Merker für die Bestätigung nach dem Start
  writeFileSync(path.join(restoreDir(data), "applied.json"), JSON.stringify(pending));
  return pending;
}

export function readApplied(data = dataDir()): PendingRestore | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(restoreDir(data), "applied.json"), "utf8")) as Partial<PendingRestore>;
    return typeof raw.from === "string" && typeof raw.at === "string" ? { from: raw.from, at: raw.at, files: raw.files === true } : null;
  } catch {
    return null;
  }
}

function finish(result: RestoreResult, data: string) {
  writeFileSync(resultFile(data), JSON.stringify(result));
  rmSync(path.join(restoreDir(data), "applied.json"), { force: true });
}

/** Die wiederhergestellte Datenbank läuft gesund: die ersetzte wird nicht mehr gebraucht. */
export function confirmRestore(applied: PendingRestore, now: string, data = dataDir()): void {
  removeWithSidecars(replacedDbFile(data));
  rmSync(replacedFilesDir(data), { recursive: true, force: true });
  finish({ at: now, from: applied.from, status: "ok" }, data);
}

/** Die App startet mit der wiederhergestellten Datenbank nicht: zurück auf die vorherige. */
export function rollbackRestore(dbFile: string, applied: PendingRestore, reason: string, now: string, data = dataDir()): void {
  removeWithSidecars(dbFile);
  if (existsSync(replacedDbFile(data))) moveWithSidecars(replacedDbFile(data), dbFile);
  if (applied.files) {
    rmSync(liveFilesDir(data), { recursive: true, force: true });
    if (existsSync(replacedFilesDir(data))) renameSync(replacedFilesDir(data), liveFilesDir(data));
  }
  finish({ at: now, from: applied.from, status: "rolled-back", reason }, data);
}

export function readRestoreResult(data = dataDir()): RestoreResult | null {
  try {
    const raw = JSON.parse(readFileSync(resultFile(data), "utf8")) as Partial<RestoreResult>;
    return typeof raw.at === "string" && typeof raw.from === "string" && (raw.status === "ok" || raw.status === "rolled-back")
      ? { at: raw.at, from: raw.from, status: raw.status, ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}) }
      : null;
  } catch {
    return null;
  }
}
