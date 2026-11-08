import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
 *
 * **Abbruch an jeder Stelle (ZP5-8):** `restore/applied.json` ist das **Journal**. Es wird *vor* dem ersten Verschieben geschrieben (mit `applying`, den Angaben, was es vorher gab
 * – `had` –, und dem, was zu tauschen ist) und erst *nach* dem letzten Schritt auf „fertig“ gestellt (jeweils atomar: Nebendatei + Umbenennen). Jeder Schritt ist **wiederholbar**
 * (er prüft, was schon verschoben ist), `pending.json` fällt erst am Ende weg. Wird der Prozess irgendwo unterbrochen, vollendet der nächste Start den Tausch (Datenbank, Dateien und
 * Schlüssel gehören immer zusammen: nie neue Datenbank mit altem Schlüssel). Dasselbe gilt für den Rückfall (`rollback` im Journal): er wird beim nächsten Start zu Ende geführt.
 * Die Bestätigung hebt den bisherigen Schlüssel auf (`previous-secret-<Zeit>.key`, nicht in Backups), damit der Stand „Vor Wiederherstellung“ lesbar bleibt.
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

/** Inhalt von `applied.json`: die Angaben der Wiederherstellung plus der Stand des Tauschs. */
type Journal = PendingRestore & {
  /** Der Tausch läuft (oder wurde unterbrochen): beim nächsten Start vollenden */
  applying?: true;
  /** Was es vor dem Tausch gab – nur dann kommt es beim Rückfall zurück, sonst wird das Eingesetzte entfernt */
  had?: { db: boolean; files: boolean; key: boolean };
  /** Der Rückfall läuft (oder wurde unterbrochen): beim nächsten Start zu Ende führen */
  rollback?: { reason: string; at: string };
};

/** Nur für Tests: wird nach jedem Schritt aufgerufen; ein Wurf daraus simuliert einen Abbruch an dieser Stelle. */
export type RestoreHooks = { after?: (step: string) => void };

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
const appliedFile = (data = dataDir()) => path.join(restoreDir(data), "applied.json");
const PREVIOUS_KEY = /^previous-secret-\d{8}T\d{6}Z(?:-\d+)?\.key$/;
/** So viele bisherige Schlüssel werden aufgehoben (ein Schlüssel ist 64 Byte; ältere Stände „Vor Wiederherstellung“ werden ohnehin nach der Aufbewahrung gelöscht) */
const PREVIOUS_KEYS_KEPT = 10;

const SUFFIXES = ["-wal", "-shm"] as const;
const sidecars = (file: string) => SUFFIXES.map((s) => `${file}${s}`);

/** Datei samt WAL/SHM verschieben: Noch nicht zurückgeschriebene Änderungen gehören zur Datei und dürfen nicht verloren gehen. */
function moveWithSidecars(from: string, to: string): void {
  for (const f of sidecars(to)) rmSync(f, { force: true });
  renameSync(from, to);
  for (const s of SUFFIXES) if (existsSync(/*turbopackIgnore: true*/ `${from}${s}`)) renameSync(/*turbopackIgnore: true*/ `${from}${s}`, /*turbopackIgnore: true*/ `${to}${s}`);
}

function removeWithSidecars(file: string): void {
  rmSync(file, { force: true });
  for (const f of sidecars(file)) rmSync(f, { force: true });
}

/** Datei atomar schreiben: erst vollständig in eine Nebendatei, dann umbenennen (nie ein halbes Journal). */
function writeAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, file);
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

function readJournal(data: string): Journal | null {
  try {
    const raw = JSON.parse(readFileSync(appliedFile(data), "utf8")) as Partial<Journal>;
    const info = parseInfo(raw);
    if (!info) return null;
    const had = raw.had && typeof raw.had === "object" ? { db: raw.had.db === true, files: raw.had.files === true, key: raw.had.key === true } : undefined;
    const rollback = raw.rollback && typeof raw.rollback.reason === "string" && typeof raw.rollback.at === "string" ? { reason: raw.rollback.reason, at: raw.rollback.at } : undefined;
    return { ...info, ...(raw.applying === true ? { applying: true as const } : {}), ...(had ? { had } : {}), ...(rollback ? { rollback } : {}) };
  } catch {
    return null;
  }
}

const writeJournal = (data: string, journal: Journal) => writeAtomic(appliedFile(data), JSON.stringify(journal));
const infoOf = (journal: Journal): PendingRestore => ({ from: journal.from, at: journal.at, files: journal.files, ...(journal.secretKey ? { secretKey: true } : {}) });

/** Ordner `from` an die Stelle `to` setzen; der bisherige Inhalt von `to` wandert nach `aside`. Wiederholbar: ist `from` schon weg, passiert nichts. */
function swapDir(from: string, to: string, aside: string): void {
  if (!existsSync(from)) return;
  if (existsSync(to)) {
    rmSync(aside, { recursive: true, force: true });
    renameSync(to, aside);
  }
  renameSync(from, to);
}

/** Die Schritte des Tauschs, jeder wiederholbar. Nach jedem Schritt meldet `hooks.after` den Namen (Tests simulieren hier Abbrüche). */
function swapIn(dbFile: string, journal: Journal, data: string, hooks: RestoreHooks): void {
  // Datenbank
  if (existsSync(pendingDbFile(data))) {
    if (existsSync(dbFile)) {
      removeWithSidecars(replacedDbFile(data));
      moveWithSidecars(dbFile, replacedDbFile(data));
      hooks.after?.("db-aside");
    } else for (const f of sidecars(dbFile)) rmSync(f, { force: true });
    moveWithSidecars(pendingDbFile(data), dbFile);
  }
  hooks.after?.("db");
  // Dateien
  if (journal.files) swapDir(pendingFilesDir(data), liveFilesDir(data), replacedFilesDir(data));
  hooks.after?.("files");
  // Geheimnisschlüssel
  if (journal.secretKey && existsSync(pendingSecretKeyFile(data))) {
    if (existsSync(liveSecretKeyFile(data))) {
      rmSync(replacedSecretKeyFile(data), { force: true });
      renameSync(liveSecretKeyFile(data), replacedSecretKeyFile(data));
      hooks.after?.("key-aside");
    }
    renameSync(pendingSecretKeyFile(data), liveSecretKeyFile(data));
  }
  hooks.after?.("key");
}

/**
 * Tauscht die Datenbank (und Dateien, Schlüssel) gegen die vorgemerkten aus. Gibt die Wiederherstellung zurück, wenn getauscht wurde. Ein früher unterbrochener Tausch
 * (Journal mit `applying`) wird vollendet, ein unterbrochener Rückfall zu Ende geführt (dann gibt es nichts zurückzugeben).
 */
export function applyPendingRestore(dbFile: string, data = dataDir(), hooks: RestoreHooks = {}): PendingRestore | null {
  let journal = readJournal(data);
  if (journal?.rollback) {
    finishRollback(dbFile, journal, data, hooks);
    return null;
  }
  if (!journal) {
    const read = readPending(data);
    if (!read) return null;
    // Der Vermerk „Geheimnisschlüssel“ gilt nur, wenn die Datei auch da ist (sonst würde ein Rückfall einen fremden Schlüssel löschen)
    const { secretKey, ...rest } = read;
    const pending: PendingRestore = secretKey && existsSync(pendingSecretKeyFile(data)) ? read : rest;
    journal = { ...pending, applying: true, had: { db: existsSync(dbFile), files: pending.files && existsSync(liveFilesDir(data)), key: !!pending.secretKey && existsSync(liveSecretKeyFile(data)) } };
    writeJournal(data, journal);
    hooks.after?.("journal");
  } else if (!journal.applying) {
    return null; // schon vollständig getauscht, wartet auf die Bestätigung
  }
  swapIn(dbFile, journal, data, hooks);
  rmSync(pendingInfoFile(data), { force: true });
  hooks.after?.("pending-info");
  const { applying, ...done } = journal;
  void applying;
  writeJournal(data, done); // „fertig“, jetzt wartet der Tausch auf die Bestätigung
  return infoOf(done);
}

export function readApplied(data = dataDir()): PendingRestore | null {
  const journal = readJournal(data);
  return journal ? infoOf(journal) : null;
}

function finish(result: RestoreResult, data: string) {
  writeFileSync(resultFile(data), JSON.stringify(result));
  rmSync(appliedFile(data), { force: true });
}

/** Die bisherigen Geheimnisschlüssel (neueste zuerst), die nach bestätigten Wiederherstellungen aufgehoben wurden – damit lässt sich der Stand „Vor Wiederherstellung“ wieder lesen. */
export function listPreviousSecretKeys(data = dataDir()): string[] {
  try {
    return readdirSync(restoreDir(data))
      .filter((name) => PREVIOUS_KEY.test(name))
      .sort()
      .reverse()
      .map((name) => readFileSync(path.join(restoreDir(data), name), "utf8").trim())
      .filter((hex) => /^[0-9a-f]{64}$/.test(hex));
  } catch {
    return [];
  }
}

/** Den ersetzten Schlüssel aufheben (statt ihn zu löschen) und die Zahl der aufgehobenen begrenzen. Wiederholbar. */
function keepPreviousSecretKey(now: string, data: string): void {
  if (!existsSync(replacedSecretKeyFile(data))) return;
  const time = new Date(now).getTime();
  const stamp = Number.isNaN(time) ? "00000000T000000" : new Date(time).toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const base = path.join(restoreDir(data), `previous-secret-${stamp}Z`);
  let target = `${base}.key`;
  for (let i = 1; existsSync(target); i++) target = `${base}-${i}.key`;
  renameSync(replacedSecretKeyFile(data), target);
  try {
    chmodSync(target, 0o600);
  } catch {
    /* Dateisysteme ohne Modi */
  }
  const kept = readdirSync(restoreDir(data)).filter((name) => PREVIOUS_KEY.test(name)).sort();
  for (const name of kept.slice(0, Math.max(0, kept.length - PREVIOUS_KEYS_KEPT))) rmSync(path.join(restoreDir(data), name), { force: true });
}

/**
 * Die wiederhergestellte Datenbank läuft gesund: die ersetzte wird nicht mehr gebraucht. Reihenfolge gegen Abbrüche: erst den bisherigen Schlüssel aufheben, dann das Journal
 * beenden (ab hier gibt es keinen Rückfall mehr), zuletzt die ersetzten Daten löschen (übrig gebliebene Reste überschreibt die nächste Wiederherstellung).
 */
export function confirmRestore(applied: PendingRestore, now: string, data = dataDir()): void {
  keepPreviousSecretKey(now, data);
  finish({ at: now, from: applied.from, status: "ok" }, data);
  removeWithSidecars(replacedDbFile(data));
  rmSync(replacedFilesDir(data), { recursive: true, force: true });
  rmSync(replacedSecretKeyFile(data), { force: true });
}

/** Rückfall, wiederholbar: Datenbank, Dateien und Schlüssel kommen zurück, soweit sie noch nicht zurück sind; was es vorher nicht gab, wird entfernt. */
function finishRollback(dbFile: string, journal: Journal, data: string, hooks: RestoreHooks): void {
  const had = journal.had ?? { db: true, files: journal.files, key: !!journal.secretKey };
  if (existsSync(replacedDbFile(data))) {
    removeWithSidecars(dbFile);
    moveWithSidecars(replacedDbFile(data), dbFile);
  } else if (!had.db) removeWithSidecars(dbFile);
  hooks.after?.("rollback-db");
  if (journal.files) {
    if (existsSync(replacedFilesDir(data))) {
      rmSync(liveFilesDir(data), { recursive: true, force: true });
      renameSync(replacedFilesDir(data), liveFilesDir(data));
    } else if (!had.files) rmSync(liveFilesDir(data), { recursive: true, force: true });
  }
  hooks.after?.("rollback-files");
  if (journal.secretKey) {
    if (existsSync(replacedSecretKeyFile(data))) {
      rmSync(liveSecretKeyFile(data), { force: true });
      renameSync(replacedSecretKeyFile(data), liveSecretKeyFile(data));
    } else if (!had.key) rmSync(liveSecretKeyFile(data), { force: true });
  }
  hooks.after?.("rollback-key");
  finish({ at: journal.rollback!.at, from: journal.from, status: "rolled-back", reason: journal.rollback!.reason }, data);
}

/** Die App startet mit der wiederhergestellten Datenbank nicht: zurück auf die vorherige. Das Journal merkt den Rückfall vor, ein Abbruch wird beim nächsten Start zu Ende geführt. */
export function rollbackRestore(dbFile: string, applied: PendingRestore, reason: string, now: string, data = dataDir(), hooks: RestoreHooks = {}): void {
  const journal: Journal = { ...(readJournal(data) ?? applied), rollback: { reason, at: now } };
  delete journal.applying;
  writeJournal(data, journal);
  hooks.after?.("rollback-journal");
  finishRollback(dbFile, journal, data, hooks);
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
