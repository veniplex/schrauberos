import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEndorsements, type Endorsement } from "./keychain";
import { emptyState, parseState, type UpdateState, type VersionMeta } from "./state";

/** Dateizugriff auf das Update-Verzeichnis (`<DATA_DIR>/app`) und auf version.json. Von App und Launcher genutzt. */

/** Datenverzeichnis: im Container `/data` (DATA_DIR), in der Entwicklung `.data` im Projektordner. */
export const dataDir = () => process.env.DATA_DIR ?? path.resolve(".data");
export const updatesDir = (data = dataDir()) => path.join(data, "app");
export const versionsDir = (data = dataDir()) => path.join(updatesDir(data), "versions");
export const versionDir = (version: string, data = dataDir()) => path.join(versionsDir(data), version);
const stateFile = (data = dataDir()) => path.join(updatesDir(data), "state.json");
/** Einzeiliger Zeiger auf das Verzeichnis der aktiven Version (leer = eingebaute); liest der Starter im Image (docker/bootstrap.c). */
export const activeFile = (data = dataDir()) => path.join(updatesDir(data), "active");
/** Vom Wurzelschlüssel beglaubigte Release-Schlüssel (Schlüsselkette, siehe keychain.ts). */
const endorsementsFile = (data = dataDir()) => path.join(updatesDir(data), "release-keys.json");
/** Marker des Starters: der Launcher dieser Version ist wiederholt abgestürzt. */
export const launcherCrashFile = (data = dataDir()) => path.join(updatesDir(data), "launcher-crash");

/** version.json eines App-Verzeichnisses; null, wenn nicht vorhanden oder ungültig. */
export function readMeta(dir: string): VersionMeta | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, "version.json"), "utf8")) as Partial<VersionMeta>;
    if (typeof raw.version === "string" && typeof raw.base === "number") {
      return { version: raw.version, base: raw.base, ...(typeof raw.node === "string" ? { node: raw.node } : {}), ...(typeof raw.arch === "string" ? { arch: raw.arch } : {}) };
    }
  } catch {
    /* fällt auf null zurück */
  }
  return null;
}

export function readState(data = dataDir()): UpdateState {
  try {
    return parseState(JSON.parse(readFileSync(stateFile(data), "utf8")));
  } catch {
    return emptyState();
  }
}

/** Atomar schreiben (temporäre Datei + Umbenennen), damit ein Absturz nie eine halbe Datei hinterlässt. */
export function writeState(state: UpdateState, data = dataDir()): void {
  mkdirSync(updatesDir(data), { recursive: true });
  const write = (file: string, content: string) => {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, content);
    renameSync(tmp, file);
  };
  // Erst der Zustand, dann der Zeiger: Der Starter folgt immer dem Zeiger, der zum gespeicherten Zustand passt
  write(stateFile(data), JSON.stringify(state, null, 2));
  write(activeFile(data), state.current ? versionDir(state.current, data) : "");
}

/** Verzeichnis der aktiven Version laut Zeiger; null = eingebaute Version. */
export function readActive(data = dataDir()): string | null {
  try {
    return readFileSync(activeFile(data), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Löscht installierte Versionen, die weder aktuell noch Rückfallebene sind (und liegengebliebene Temp-Ordner). */
export function pruneVersions(keep: readonly string[], data = dataDir()): void {
  const dir = versionsDir(data);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!keep.includes(name)) rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

/** Gemerkte, vom Wurzelschlüssel beglaubigte Release-Schlüssel; die Datei wird bei jeder Verwendung neu geprüft (nie blind vertraut). */
export function readEndorsements(data = dataDir()): Endorsement[] {
  try {
    return parseEndorsements(JSON.parse(readFileSync(endorsementsFile(data), "utf8")));
  } catch {
    return [];
  }
}

export function writeEndorsements(endorsements: readonly Endorsement[], data = dataDir()): void {
  mkdirSync(updatesDir(data), { recursive: true });
  const file = endorsementsFile(data);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ keys: endorsements }, null, 2));
  renameSync(tmp, file);
}
