import { createReadStream, existsSync, rmdirSync, readdirSync, statSync, type ReadStream } from "node:fs";
import { link, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { safeName } from "@/lib/filename";
import { dataDir } from "@/lib/updates/store";

export { safeName };

/**
 * Dateispeicher für Rechnungsbelege und Dokumentationsbilder: ganz normale Dateien unter `<Datenverzeichnis>/files` mit lesbaren
 * Pfaden (z. B. `rechnungen/2026/eingang/2026-03-14_Lieferant_RE-1234.pdf`), die sich auch ohne die Anwendung finden und öffnen
 * lassen. In der Datenbank steht nur der relative Pfad.
 *
 * Regeln: Dateien werden nie überschrieben (bei gleichem Namen kommt ein Zähler dazu) und nie nachträglich verändert – das macht
 * Backups per Hardlink möglich. Pfade bestehen nur aus ASCII-Zeichen `A–Z a–z 0–9 . _ -` und stammen nie direkt aus Eingaben.
 */

export const filesDir = () => path.join(/*turbopackIgnore: true*/ dataDir(), "files");
const tmpDir = () => path.join(filesDir(), ".tmp");

const REL = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

/** Absoluter Pfad zu einem relativen Dateipfad; wirft bei allem, was nicht dem festen Muster entspricht (Schutz vor Pfad-Tricks). */
export function resolveRel(rel: string): string {
  if (!REL.test(rel) || rel.includes("..")) throw new Error("Ungültiger Dateipfad");
  const full = path.join(filesDir(), ...rel.split("/"));
  if (!full.startsWith(filesDir() + path.sep)) throw new Error("Ungültiger Dateipfad");
  return full;
}

const join = (dir: string, name: string) => `${dir}/${name}`;

/**
 * Legt eine Datei unter `dir/fileName` ab (Ordner werden angelegt) und liefert den relativen Pfad. Gibt es den Namen schon,
 * wird `-2`, `-3` … vor der Endung angehängt. Geschrieben wird erst in eine Zwischendatei und dann atomar eingehängt.
 */
export async function storeFile(dir: string, fileName: string, data: Uint8Array): Promise<string> {
  const dirParts = dir.split("/").map((p) => safeName(p, 40));
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  const base = safeName(stem, 100);
  const safeExt = ext ? `.${safeName(ext.slice(1), 10).toLowerCase()}` : "";

  await mkdir(tmpDir(), { recursive: true });
  const tmp = path.join(tmpDir(), `${randomBytes(8).toString("hex")}.part`);
  await writeFile(tmp, data, { flag: "wx" });
  try {
    await mkdir(resolveRel(dirParts.join("/")), { recursive: true });
    for (let n = 1; n < 1000; n++) {
      const rel = join(dirParts.join("/"), `${base}${n === 1 ? "" : `-${n}`}${safeExt}`);
      try {
        await link(tmp, resolveRel(rel)); // schlägt fehl, wenn es die Datei schon gibt – überschreibt nie
        return rel;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new Error("Kein freier Dateiname");
  } finally {
    await rm(tmp, { force: true });
  }
}

export const openFile = (rel: string): ReadStream => createReadStream(resolveRel(rel));
export const fileExists = (rel: string): boolean => existsSync(resolveRel(rel));
export const fileSize = (rel: string): number => statSync(resolveRel(rel)).size;

/** Entfernt leere Ordner von der Datei aufwärts bis (ausschließlich) zum Dateiverzeichnis. */
function pruneEmptyDirs(start: string): void {
  let dir = start;
  while (dir.startsWith(filesDir() + path.sep) && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

export async function removeFile(rel: string): Promise<void> {
  const full = resolveRel(rel);
  await unlink(full).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
  pruneEmptyDirs(path.dirname(full));
}

/** Verschiebt/benennt eine Datei um (ohne Überschreiben) und liefert den neuen relativen Pfad. */
export async function moveFile(rel: string, dir: string, fileName: string): Promise<string> {
  const from = resolveRel(rel);
  const dirParts = dir.split("/").map((p) => safeName(p, 40));
  const ext = path.extname(fileName);
  const base = safeName(fileName.slice(0, fileName.length - ext.length), 100);
  const safeExt = ext ? `.${safeName(ext.slice(1), 10).toLowerCase()}` : "";
  await mkdir(resolveRel(dirParts.join("/")), { recursive: true });
  for (let n = 1; n < 1000; n++) {
    const target = join(dirParts.join("/"), `${base}${n === 1 ? "" : `-${n}`}${safeExt}`);
    if (target === rel) return rel;
    try {
      await link(from, resolveRel(target)); // Hardlink statt Umbenennen: Backups behalten den alten Pfad, die Datei wird nie überschrieben
      await unlink(from);
      pruneEmptyDirs(path.dirname(from));
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Kein freier Dateiname");
}
