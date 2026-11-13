import "server-only";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { filesDir, removeFile, resolveRel } from "@/server/files";
import { logError } from "@/lib/log-safe";

/**
 * Lesen, Prüfen und Aufräumen der **Originale** festgeschriebener Rechnungen (`InvoiceOriginal`, Erzeugung: `originals.ts`) – getrennt von der Erzeugung, damit Aufräumlauf, Routen und Seiten die PDF-Bibliothek nicht laden.
 */
export const ORIGINALS_DIR = "rechnungen/original";
export const ORIGINAL_KINDS = ["pdf", "xml"] as const;
export type OriginalKind = (typeof ORIGINAL_KINDS)[number];
/** Verwaiste Dateien werden erst nach dieser Zeit gelöst (eine Transaktion, die die Zeile noch anlegt, ist nie so alt). */
export const ORPHAN_MIN_AGE_MS = 3_600_000;

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export type OriginalFile = { bytes: Buffer; kind: OriginalKind; path: string; createdAt: Date };

/**
 * Liest ein Original vom Datenträger und prüft die SHA-256 (eine veränderte oder beschädigte Datei wird nie als Original ausgeliefert). `null` = es gibt keins (nie erzeugt, XML nicht möglich, nach der
 * Anonymisierung gelöst). `"damaged"` = Zeile da, Datei fehlt oder stimmt nicht mit der Prüfsumme.
 */
export async function readOriginal(invoiceId: string, kind: OriginalKind): Promise<OriginalFile | "damaged" | null> {
  const row = await db.invoiceOriginal.findUnique({ where: { invoiceId_kind: { invoiceId, kind } }, select: { path: true, sha256: true, size: true, createdAt: true } });
  if (!row) return null;
  try {
    const bytes = await readFile(resolveRel(row.path));
    if (bytes.byteLength !== row.size || sha256(bytes) !== row.sha256) return "damaged";
    return { bytes, kind, path: row.path, createdAt: row.createdAt };
  } catch {
    return "damaged";
  }
}

/** Zustand der Originale eines Beleges (Seite): `ok` = vorhanden und unverändert, `damaged` = Zeile da, Datei fehlt oder stimmt nicht mit der Prüfsumme, `none` = gibt es nicht. */
export type OriginalState = "ok" | "damaged" | "none";
export async function originalStates(invoiceId: string): Promise<Record<OriginalKind, OriginalState>> {
  const [pdf, xml] = await Promise.all(ORIGINAL_KINDS.map((kind) => readOriginal(invoiceId, kind)));
  const state = (value: OriginalFile | "damaged" | null): OriginalState => (value === null ? "none" : value === "damaged" ? "damaged" : "ok");
  return { pdf: state(pdf), xml: state(xml) };
}

const BATCH = 100;

/** Löst Originale, deren `purgeAfter` erreicht ist (Anonymisierung des Kunden nach Ablauf der Aufbewahrungsfristen): erst die Datei, dann die Zeile; wiederholbar. */
export async function purgeOriginals(now: Date = new Date()): Promise<number> {
  let purged = 0;
  for (;;) {
    const rows = await db.invoiceOriginal.findMany({ where: { purgeAfter: { not: null, lte: now } }, orderBy: { purgeAfter: "asc" }, take: BATCH, select: { id: true, path: true } });
    if (rows.length === 0) return purged;
    for (const row of rows) {
      await removeFile(row.path);
      await db.invoiceOriginal.delete({ where: { id: row.id } });
      purged++;
    }
    if (rows.length < BATCH) return purged;
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Löst Dateien unter `rechnungen/original/` ohne Zeile (Rückrollen der Transaktion nach dem Ablegen), wenn sie älter als `ORPHAN_MIN_AGE_MS` sind. Eine Datei **mit** Zeile wird nie angefasst. Asynchron, Dateien einzeln.
 */
export async function purgeOrphanOriginals(now: Date = new Date()): Promise<number> {
  const root = path.join(/*turbopackIgnore: true*/ filesDir(), ...ORIGINALS_DIR.split("/"));
  let removed = 0;
  for await (const full of walk(root)) {
    const rel = path.relative(filesDir(), full).split(path.sep).join("/");
    try {
      const info = await stat(full);
      if (now.getTime() - info.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      if (await db.invoiceOriginal.findUnique({ where: { path: rel }, select: { id: true } })) continue;
      await removeFile(rel);
      removed++;
    } catch (error) {
      logError("billing:originals", error);
    }
  }
  return removed;
}
