import path from "node:path";
import * as tar from "tar";

/**
 * Sicheres Entpacken von tar-Archiven (hochgeladene Backups, Update-Pakete). Das Archiv ist nicht vertrauenswürdig (Backups kommen vom Benutzer, ein Paket
 * ist zwar signiert, aber Fehler in der Pipeline sollen nicht zu Dateien außerhalb des Ziels führen):
 *  - **nur Ordner und normale Dateien** – Symlinks, Hardlinks (zeigen auf fremde Dateien), Geräte-Dateien, Pipes u. ä. werden abgelehnt. Einzige Ausnahme, nur
 *    auf Wunsch des Aufrufers (`symlinks: "inside"`, Update-Pakete mit ihren Bibliotheken): relative Symlinks, deren Ziel im Zielverzeichnis bleibt,
 *  - **keine** absoluten Pfade, `..`, Laufwerksbuchstaben, Rückwärtsstriche oder NUL-Zeichen im Pfad,
 *  - **Obergrenzen** für die Zahl der Einträge und die Gesamtgröße (aus den Köpfen der Einträge, bevor etwas geschrieben wird): ein Archiv mit Millionen leerer
 *    Einträge oder einer 100-Gigabyte-Datei füllt weder die Platte noch das Dateisystem.
 * Beim ersten Verstoß wird nichts mehr geschrieben (die Einträge danach werden übersprungen) und am Ende mit `ArchiveError` abgebrochen; der Aufrufer räumt das
 * Zielverzeichnis auf. Zusätzlich verweigert node-tar selbst das Schreiben außerhalb des Ziels.
 */

export type ArchiveErrorCode = "unsupported" | "unsafePath" | "tooManyEntries" | "tooLarge" | "corrupt";

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export type ArchiveLimits = { maxEntries: number; maxBytes: number };

const ALLOWED_TYPES = new Set(["File", "OldFile", "ContiguousFile", "Directory"]);

/** Bleibt das Ziel eines Symlinks (relativ zu seinem Ordner) im Zielverzeichnis des Entpackens? */
export function symlinkStaysInside(entryPath: string, linkPath: string): boolean {
  if (!linkPath || linkPath.includes("\0") || linkPath.includes("\\") || linkPath.startsWith("/") || /^[A-Za-z]:/.test(linkPath)) return false;
  const base = "/__root__";
  const target = path.posix.resolve(base, path.posix.dirname(entryPath), linkPath);
  return target.startsWith(`${base}/`);
}

/** Ist der Pfad eines Archiv-Eintrags nicht erlaubt (absolut, `..`, Laufwerk, Rückwärtsstrich, NUL, leer)? */
export function unsafeEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath.includes("\0") || entryPath.includes("\\")) return true;
  if (entryPath.startsWith("/") || /^[A-Za-z]:/.test(entryPath)) return true;
  return entryPath.split("/").some((segment) => segment === "..");
}

export type ExtractOptions = {
  /** `reject` (Standard): keine Symlinks. `inside`: relative Symlinks, die im Zielverzeichnis bleiben (Hardlinks nie). */
  symlinks?: "reject" | "inside";
  /** Dateirechte aus dem Archiv nicht übernehmen (Backups); Update-Pakete brauchen ausführbare Dateien */
  noChmod?: boolean;
};

/** Entpackt `file` nach `cwd` unter den Grenzen oben. Liefert Anzahl der Einträge und Gesamtgröße; wirft `ArchiveError`. */
export async function extractArchive(file: string, cwd: string, limits: ArchiveLimits, options: ExtractOptions = {}): Promise<{ entries: number; bytes: number }> {
  let violation: ArchiveError | null = null;
  let entries = 0;
  let bytes = 0;
  const reject = (code: ArchiveErrorCode, detail?: string): false => {
    violation ??= new ArchiveError(code, detail);
    return false;
  };

  try {
    await tar.x({
      file,
      cwd,
      strict: true,
      preservePaths: false,
      noChmod: options.noChmod ?? false,
      filter: (entryPath, entry) => {
        if (violation) return false;
        const type = (entry as tar.ReadEntry).type;
        const isSymlink = type === "SymbolicLink";
        if (isSymlink && options.symlinks === "inside") {
          if (unsafeEntryPath(entryPath) || !symlinkStaysInside(entryPath, (entry as tar.ReadEntry).linkpath ?? "")) return reject("unsafePath", "SymbolicLink");
        } else if (!ALLOWED_TYPES.has(type)) return reject("unsupported", type);
        if (unsafeEntryPath(entryPath)) return reject("unsafePath");
        entries += 1;
        if (entries > limits.maxEntries) return reject("tooManyEntries");
        bytes += (entry as tar.ReadEntry).size ?? 0;
        if (bytes > limits.maxBytes) return reject("tooLarge");
        return true;
      },
    });
  } catch {
    throw violation ?? new ArchiveError("corrupt");
  }
  if (violation) throw violation;
  return { entries, bytes };
}
