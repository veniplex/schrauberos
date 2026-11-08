import { constants as fsConstants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { removeTreeSync } from "./fs-tree";
import { parseEndorsements, type Endorsement } from "./keychain";
import { emptyState, parseState, type UpdateState, type VersionMeta } from "./state";

/** Dateizugriff auf das Update-Verzeichnis (`<DATA_DIR>/app`) und auf version.json. Von App und Launcher genutzt. */

/** Datenverzeichnis: im Container `/data` (DATA_DIR), in der Entwicklung `.data` im Projektordner. */
export const dataDir = () => process.env.DATA_DIR ?? path.resolve(/*turbopackIgnore: true*/ ".data");
export const updatesDir = (data = dataDir()) => path.join(/*turbopackIgnore: true*/ data, "app");
export const versionsDir = (data = dataDir()) => path.join(updatesDir(data), "versions");
export const versionDir = (version: string, data = dataDir()) => path.join(versionsDir(data), version);
const stateFile = (data = dataDir()) => path.join(updatesDir(data), "state.json");
/** Einzeiliger Zeiger auf das Verzeichnis der aktiven Version (leer = eingebaute); liest der Starter im Image (docker/bootstrap.c). */
export const activeFile = (data = dataDir()) => path.join(updatesDir(data), "active");
/** Vom Wurzelschlüssel beglaubigte Release-Schlüssel (Schlüsselkette, siehe keychain.ts). */
const endorsementsFile = (data = dataDir()) => path.join(updatesDir(data), "release-keys.json");
/** Marker des Starters: der Launcher dieser Version ist wiederholt abgestürzt. */
export const launcherCrashFile = (data = dataDir()) => path.join(updatesDir(data), "launcher-crash");
/** Marker des Starters (Format und Bedeutung: markers.ts): Integritätsbefund, unklare Prüfung, letzte erfolgreiche Prüfung; Marker des Launchers: Rückfall zu alt für die Datenbank. */
export const verifyFailedFile = (data = dataDir()) => path.join(updatesDir(data), "verify-failed");
export const inconclusiveFile = (data = dataDir()) => path.join(updatesDir(data), "inconclusive");
export const verifyOkFile = (data = dataDir()) => path.join(updatesDir(data), "verify-ok");
export const incompatibleFile = (data = dataDir()) => path.join(updatesDir(data), "incompatible");

/**
 * Liest eine kleine Textdatei, die jemand anderes geschrieben hat (Marker sind Daten): nur reguläre Dateien (kein FIFO, der blockiert), höchstens `max` Bytes,
 * `null`, wenn sie fehlt oder nicht lesbar ist. Öffnet nicht blockierend und folgt keinem Symlink, wo das Betriebssystem es kann.
 */
export function readSmallFile(file: string, max = 4096): string | null {
  let fd: number | null = null;
  try {
    const flags = (fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOFOLLOW ?? 0)) >>> 0;
    fd = openSync(file, flags);
    if (!fstatSync(fd).isFile()) return null;
    const buffer = Buffer.alloc(max);
    const read = readSync(fd, buffer, 0, max, 0);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Entfernt einen Marker, egal was dort liegt (Datei, Link, FIFO oder ein – auch nicht leeres – Verzeichnis, das die App vor dem Neustart angelegt hat), und wirft nie: ein Hindernis
 * unter einem Markernamen darf den Start der eingebauten App nicht verhindern. Gibt zurück, ob danach nichts mehr dort liegt.
 */
export function removeMarker(file: string): boolean {
  try {
    rmSync(file, { recursive: true, force: true });
  } catch {
    /* geprüft wird unten */
  }
  try {
    lstatSync(file);
    return false;
  } catch {
    return true;
  }
}

/** version.json eines App-Verzeichnisses; null, wenn nicht vorhanden oder ungültig. */
export function readMeta(dir: string): VersionMeta | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, "version.json"), "utf8")) as Partial<VersionMeta>;
    if (typeof raw.version === "string" && typeof raw.base === "number") {
      return { version: raw.version, base: raw.base, ...(typeof raw.node === "string" ? { node: raw.node } : {}), ...(typeof raw.arch === "string" ? { arch: raw.arch } : {}), ...(typeof raw.commit === "string" && /^[0-9a-f]{7,40}$/i.test(raw.commit) ? { commit: raw.commit.toLowerCase() } : {}) };
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

/**
 * Atomar schreiben (temporäre Datei + Umbenennen), damit ein Absturz nie eine halbe Datei hinterlässt. Liegt ein Verzeichnis unter dem Namen von `state.json` oder `active`
 * (die App darf dort schreiben), wird es entfernt und die Datei neu angelegt – sonst bliebe der Zustand für immer unschreibbar.
 */
export function writeState(state: UpdateState, data = dataDir()): void {
  mkdirSync(updatesDir(data), { recursive: true });
  const write = (file: string, content: string) => {
    const tmp = `${file}.${process.pid}.tmp`;
    removeMarker(tmp);
    writeFileSync(tmp, content);
    try {
      renameSync(tmp, file);
    } catch (error) {
      let isDirectory = false;
      try {
        isDirectory = lstatSync(file).isDirectory();
      } catch {
        /* nicht vorhanden: der Fehler war ein anderer */
      }
      if (!isDirectory) throw error;
      rmSync(file, { recursive: true, force: true });
      renameSync(tmp, file);
    }
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
    if (!keep.includes(name)) removeTreeSync(path.join(dir, name));
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

// ───────── Kopien der Release-Notizen („Was ist neu“, offline lesbar) ─────────

const notesDir = (data = dataDir()) => path.join(updatesDir(data), "notes");
const NOTES_VERSION = /^\d+\.\d+\.\d+$/;

/** Kopie der Notizen einer Version aus dem Datenverzeichnis; `null`, wenn es keine gibt (oder die Version kein gültiger Name ist). */
export function readNotesCopy(version: string, data = dataDir()): string | null {
  if (!NOTES_VERSION.test(version)) return null;
  try {
    return readFileSync(path.join(notesDir(data), `${version}.md`), "utf8");
  } catch {
    return null;
  }
}

/** Legt die Notizen einer Version als Kopie ab (Fehler dabei sind unwichtig: die Kopie ist nur eine Erleichterung für den Betrieb ohne Netz). */
export function writeNotesCopy(version: string, value: { notes: string }, data = dataDir()): void {
  if (!NOTES_VERSION.test(version)) return;
  try {
    mkdirSync(notesDir(data), { recursive: true });
    const target = path.join(notesDir(data), `${version}.md`);
    writeFileSync(`${target}.tmp`, value.notes);
    renameSync(`${target}.tmp`, target);
  } catch {
    /* nur eine Erleichterung */
  }
}
