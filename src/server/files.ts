import { createReadStream, existsSync, rmdirSync, readdirSync, statSync, type ReadStream } from "node:fs";
import { link, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { safeName } from "@/lib/filename";
import { diskSpace } from "@/lib/disk";
import { dataDir } from "@/lib/updates/store";
import { OperationError } from "@/server/operations/errors";

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
 * Platzschutz (Z7): Uploads stoppen **deutlich vor** SQLite. Nach dem Ablegen müssen mindestens `max(256 MiB, 5 % des Datenträgers)` frei bleiben – diese Reserve gehört der Datenbank, den Sitzungen, dem
 * Audit-Log und den Backups. Sonst könnte ein voller Datenträger auch die Anmeldung sperren (Sitzung und Protokoll brauchen Schreibzugriff), und die Rettung läge in der Weboberfläche, die man dann nicht mehr
 * betreten kann. Meldet das Dateisystem den Platz nicht, wird nichts abgewiesen. Der Fehler ist ein `OperationError` (Code `storageFull`): Operationen melden ihn als Meldung bzw. HTTP 507.
 */
export const UPLOAD_RESERVE_MIN_BYTES = 256 * 1024 * 1024;
export const UPLOAD_RESERVE_FRACTION = 0.05;

export async function assertRoomFor(bytes: number): Promise<void> {
  const space = await diskSpace(dataDir());
  if (!space) return;
  const reserve = Math.max(UPLOAD_RESERVE_MIN_BYTES, Math.ceil(space.totalBytes * UPLOAD_RESERVE_FRACTION));
  if (space.freeBytes - bytes < reserve) throw new OperationError({ code: "storageFull" });
}

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

  await assertRoomFor(data.byteLength);
  await mkdir(tmpDir(), { recursive: true });
  const tmp = path.join(tmpDir(), `${randomBytes(8).toString("hex")}.part`);
  try {
    await writeFile(tmp, data, { flag: "wx" });
  } catch (error) {
    // Platte voll mitten im Schreiben (trotz Reserve, z. B. ein anderer Prozess war schneller): halbe Zwischendatei weg, klare Meldung statt eines allgemeinen Fehlers
    await rm(tmp, { force: true }).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "ENOSPC") throw new OperationError({ code: "storageFull" });
    throw error;
  }
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

/**
 * Räumt verwaiste Zwischendateien auf (Z6-2 N10): Bricht der Prozess zwischen dem Schreiben und dem Einhängen ab (Absturz, Neustart, Strom), bleibt `.tmp/<zufall>.part` liegen und belegt Platz (Backups
 * verlinken sie mit). Gelöscht werden nur Dateien dieses Ordners, die älter als `maxAgeMs` sind (Standard ein Tag – ein laufender Upload ist nie so alt), asynchron; Fehler einzelner Dateien halten nichts auf.
 * Läuft beim Start der Anwendung. Liefert die Zahl der gelöschten Dateien.
 */
export async function cleanStaleTemp(maxAgeMs = 24 * 3_600_000, now = Date.now()): Promise<number> {
  let removed = 0;
  let names: string[];
  try {
    names = await readdir(tmpDir());
  } catch {
    return 0; // noch kein Dateiverzeichnis: nichts zu tun
  }
  for (const name of names) {
    if (!name.endsWith(".part")) continue;
    try {
      const full = path.join(tmpDir(), name);
      const info = await stat(full);
      if (info.isFile() && now - info.mtimeMs > maxAgeMs) {
        await unlink(full);
        removed++;
      }
    } catch {
      /* verschwunden oder nicht löschbar: weiter */
    }
  }
  return removed;
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
