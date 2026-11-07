import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./store";

/**
 * Wiederherstellung einer Datenbank-Sicherung – gemeinsam genutzt von der App (stellt die Wiederherstellung bereit) und vom
 * Launcher (tauscht die Datei vor dem Start aus und fällt zurück, wenn die App danach nicht gesund startet).
 *
 * Ablauf: App legt `restore/pending.db` (+ `restore/pending-files/`, falls die Sicherung Dateien enthält) und `pending.json` an und
 * beendet sich → Launcher verschiebt die laufende Datenbank nach `restore/replaced.db` (und `files/` nach `restore/replaced-files/`),
 * setzt die vorgemerkten ein, startet → bei Erfolg werden die ersetzten gelöscht, sonst kommen sie zurück. Das Ergebnis steht in `restore/result.json` und wird in der Oberfläche angezeigt.
 *
 * Wurde die Wiederherstellung mit dem Wiederherstellungsschlüssel angestoßen, liegt zusätzlich `restore/pending-secret.key` bereit (der aus der Sicherung entschlüsselte
 * Geheimnisschlüssel): Der Launcher setzt ihn im selben Schritt als `secret.key` ein (die bisherige Datei wandert nach `restore/replaced-secret.key`) und stellt sie bei einem Rückfall wieder her.
 */

export type PendingRestore = {
  from: string;
  at: string;
  /** Dateien (Belege, Bilder) mit austauschen */
  files: boolean;
  /** Der Geheimnisschlüssel (`secret.key`) wird mit ausgetauscht (Wiederherstellung mit Wiederherstellungsschlüssel) */
  secretKey?: boolean;
};
export type RestoreResult = { at: string; from: string; status: "ok" | "rolled-back"; reason?: string };

export const restoreDir = (data = dataDir()) => path.join(data, "restore");
export const pendingDbFile = (data = dataDir()) => path.join(restoreDir(data), "pending.db");
const pendingInfoFile = (data = dataDir()) => path.join(restoreDir(data), "pending.json");
export const pendingFilesDir = (data = dataDir()) => path.join(restoreDir(data), "pending-files");
const replacedFilesDir = (data = dataDir()) => path.join(restoreDir(data), "replaced-files");
const liveFilesDir = (data = dataDir()) => path.join(data, "files");
export const pendingSecretKeyFile = (data = dataDir()) => path.join(restoreDir(data), "pending-secret.key");
const replacedSecretKeyFile = (data = dataDir()) => path.join(restoreDir(data), "replaced-secret.key");
const liveSecretKeyFile = (data = dataDir()) => path.join(data, "secret.key");
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

/** Legt den entschlüsselten Geheimnisschlüssel für die Wiederherstellung bereit (nur für den Besitzer lesbar). */
export function writePendingSecretKey(hex: string, data = dataDir()): void {
  mkdirSync(restoreDir(data), { recursive: true });
  writeFileSync(pendingSecretKeyFile(data), hex, { mode: 0o600 });
  try {
    chmodSync(pendingSecretKeyFile(data), 0o600);
  } catch {
    /* Dateisysteme ohne Modi */
  }
}

const parseInfo = (raw: Partial<PendingRestore>): PendingRestore | null =>
  typeof raw.from === "string" && typeof raw.at === "string" ? { from: raw.from, at: raw.at, files: raw.files === true, ...(raw.secretKey === true ? { secretKey: true } : {}) } : null;

export function readPending(data = dataDir()): PendingRestore | null {
  try {
    if (!existsSync(pendingDbFile(data))) return null;
    return parseInfo(JSON.parse(readFileSync(pendingInfoFile(data), "utf8")) as Partial<PendingRestore>);
  } catch {
    return null;
  }
}

export function cancelPending(data = dataDir()): void {
  rmSync(pendingDbFile(data), { force: true });
  for (const f of sidecars(pendingDbFile(data))) rmSync(f, { force: true });
  rmSync(pendingFilesDir(data), { recursive: true, force: true });
  rmSync(pendingSecretKeyFile(data), { force: true });
  rmSync(pendingInfoFile(data), { force: true });
}

/** Tauscht die Datenbank gegen die vorgemerkte aus. Gibt true zurück, wenn getauscht wurde. */
export function applyPendingRestore(dbFile: string, data = dataDir()): PendingRestore | null {
  const read = readPending(data);
  if (!read) return null;
  // Der Vermerk „Geheimnisschlüssel“ gilt nur, wenn die Datei auch da ist (sonst würde ein Rückfall einen fremden Schlüssel löschen)
  const { secretKey, ...rest } = read;
  const pending: PendingRestore = secretKey && existsSync(pendingSecretKeyFile(data)) ? read : rest;
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
  if (pending.secretKey) {
    // Geheimnisschlüssel: der bisherige (falls vorhanden) wandert zur Seite, der entschlüsselte aus der Sicherung wird `secret.key`
    rmSync(replacedSecretKeyFile(data), { force: true });
    if (existsSync(liveSecretKeyFile(data))) renameSync(liveSecretKeyFile(data), replacedSecretKeyFile(data));
    renameSync(pendingSecretKeyFile(data), liveSecretKeyFile(data));
  }
  rmSync(pendingInfoFile(data), { force: true });
  // Merker für die Bestätigung nach dem Start
  writeFileSync(path.join(restoreDir(data), "applied.json"), JSON.stringify(pending));
  return pending;
}

export function readApplied(data = dataDir()): PendingRestore | null {
  try {
    return parseInfo(JSON.parse(readFileSync(path.join(restoreDir(data), "applied.json"), "utf8")) as Partial<PendingRestore>);
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
  rmSync(replacedSecretKeyFile(data), { force: true });
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
  if (applied.secretKey) {
    rmSync(liveSecretKeyFile(data), { force: true });
    if (existsSync(replacedSecretKeyFile(data))) renameSync(replacedSecretKeyFile(data), liveSecretKeyFile(data));
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
