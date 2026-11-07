/**
 * `SOS-TREE`: die Dateiliste einer App-Version (Starter-Vertrauensanker, README „Starter-Vertrauensanker“). Reine Funktionen über die Schnittstelle `FsLike`
 * (Windows-tauglich testbar); `nodeFs` ist die Implementierung auf dem echten Dateisystem. Nur löschbare TypeScript-Syntax, relative Importe mit `.ts`:
 * `scripts/gen-tree.mjs` und `scripts/make-seal.mjs` importieren dieses Modul direkt mit Node.
 *
 * **Format** (UTF-8, nur `\n`, Felder durch TAB, keine Kommentare, keine Leerzeilen):
 *
 *     schrauberos-tree 1\n
 *     hash sha512\n
 *     <Typ>\t<Ausführbit>\t<Größe>\t<Hash|Ziel|->\t<Pfad>\n          (ein Eintrag je Zeile)
 *
 *  - **Typ** `d` (Ordner) · `f` (reguläre Datei) · `l` (Symlink); alles andere (Sockets, FIFOs, Geräte) gibt es im Paket nicht.
 *  - **Ausführbit** `x` oder `-`; `x` nur bei Dateien, die ein Ausführbit tragen (`mode & 0111 != 0`), sonst `-` (auch bei Ordnern und Symlinks).
 *    Volle Modi sind absichtlich nicht Teil der Aussage: `tar.x` entpackt sie mit der Umask des Prozesses. Setuid, Setgid und Sticky sind überall verboten.
 *  - **Größe** Dezimalzahl ohne führende Nullen (Bytes; bei `d` und `l` immer `0`); **Hash** 128 Kleinbuchstaben-Hexziffern SHA-512 (nur `f`),
 *    **Ziel** der Linkinhalt (nur `l`), `-` bei `d`.
 *  - **Pfad** relativ zur Wurzel, `/`-getrennt, letztes Feld; ohne führendes `./` oder `/`, ohne leere, `.`- oder `..`-Teile, ohne Steuerzeichen
 *    (< 0x20, 0x7f), `\`, U+FFFD; höchstens 1024 Bytes UTF-8 und 48 Ebenen. `SOS-TREE` und `SOS-SEAL` im Wurzelverzeichnis stehen **nicht** in der Liste.
 *  - **Reihenfolge:** streng aufsteigend nach den **Bytes** des Pfads (nie `localeCompare`), keine Doppelten. Jeder Elternordner steht als `d` in der Liste
 *    (er ist wegen der Byte-Reihenfolge immer vor seinen Kindern). Unter Dateien und Symlinks gibt es keine Einträge.
 *  - **Symlink-Ziele:** relativ, kanonisch (`..` nur am Anfang, keine `.`-Teile, keine leeren Teile), das Ziel bleibt im Baum, und der aufgelöste Weg führt
 *    nicht über einen weiteren Symlink (so ist die Auflösung im geprüften Baum eindeutig).
 *  - **Grenzen:** ≤ 200 000 Einträge, ≤ 48 MiB Listendatei, Dateigröße ≤ 2^40.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import path from "node:path";

export const TREE_HEADER = "schrauberos-tree 1\nhash sha512\n";
export const TREE_FILE = "SOS-TREE";
export const SEAL_FILE = "SOS-SEAL";

export const TREE_LIMITS = {
  maxEntries: 200_000,
  maxTreeBytes: 48 * 1024 * 1024,
  maxPathBytes: 1024,
  maxDepth: 48,
  maxFileSize: 2 ** 40,
} as const;

export type TreeEntry = {
  type: "d" | "f" | "l";
  /** nur Dateien: trägt ein Ausführbit */
  exec: boolean;
  size: number;
  /** SHA-512 (Hex), nur `f` */
  hash?: string;
  /** Linkinhalt, nur `l` */
  target?: string;
  path: string;
};

export type TreeErrorCode = "format" | "name" | "type" | "setid" | "link" | "limit" | "io";

export class TreeError extends Error {
  code: TreeErrorCode;
  path?: string;
  constructor(code: TreeErrorCode, message: string, entryPath?: string) {
    super(entryPath === undefined ? message : `${message}: ${entryPath}`);
    this.code = code;
    this.path = entryPath;
  }
}

// ───────── Dateisystem-Schnittstelle ─────────

export type FsKind = "file" | "dir" | "symlink" | "other";
export type FsStat = { kind: FsKind; size: number; /** Modusbits einschließlich Setuid/Setgid/Sticky (`mode & 07777`) */ mode: number };

/** Lesender Zugriff auf einen Baum. Pfade sind relativ zur Wurzel, `/`-getrennt; `""` ist die Wurzel. */
export interface FsLike {
  /** `null`, wenn es den Eintrag nicht gibt (ohne einem Symlink zu folgen). */
  lstat(rel: string): Promise<FsStat | null>;
  readdir(rel: string): Promise<string[]>;
  readlink(rel: string): Promise<string>;
  /** SHA-512 (Hex) und tatsächlich gelesene Bytes einer regulären Datei. */
  hash(rel: string): Promise<{ sha512: string; size: number }>;
  /** Liest eine kleine Datei höchstens bis `maxBytes` (mehr → `null`). */
  readFile(rel: string, maxBytes: number): Promise<Buffer | null>;
}

/** Das echte Dateisystem unterhalb von `root`. */
export function nodeFs(root: string): FsLike {
  const abs = (rel: string) => (rel === "" ? root : path.join(root, ...rel.split("/")));
  const io = (error: unknown, rel: string): never => {
    throw new TreeError("io", `Ein-/Ausgabefehler (${(error as NodeJS.ErrnoException).code ?? "?"})`, rel);
  };
  return {
    async lstat(rel) {
      try {
        const st = await lstat(abs(rel));
        return { kind: st.isDirectory() ? "dir" : st.isFile() ? "file" : st.isSymbolicLink() ? "symlink" : "other", size: st.size, mode: st.mode & 0o7777 };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return null;
        return io(error, rel);
      }
    },
    async readdir(rel) {
      try {
        return await readdir(abs(rel));
      } catch (error) {
        return io(error, rel);
      }
    },
    async readlink(rel) {
      try {
        return await readlink(abs(rel));
      } catch (error) {
        return io(error, rel);
      }
    },
    async hash(rel) {
      const hash = createHash("sha512");
      let size = 0;
      try {
        for await (const chunk of createReadStream(abs(rel), { highWaterMark: 256 * 1024 })) {
          hash.update(chunk as Buffer);
          size += (chunk as Buffer).length;
        }
      } catch (error) {
        return io(error, rel);
      }
      return { sha512: hash.digest("hex"), size };
    },
    async readFile(rel, maxBytes) {
      let handle;
      try {
        handle = await open(abs(rel), "r");
        const buffer = Buffer.alloc(maxBytes + 1);
        let total = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > maxBytes) return null;
        }
        return Buffer.from(buffer.subarray(0, total));
      } catch (error) {
        return io(error, rel);
      } finally {
        await handle?.close();
      }
    },
  };
}

// ───────── Namen, Pfade, Ziele ─────────

const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f\\�]/;

/** Sind Pfad und Namen im Sinne des Formats zulässig? Liefert den Grund oder `null`. */
export function pathProblem(entryPath: string): string | null {
  if (entryPath === "" || entryPath.startsWith("/")) return "leer oder absolut";
  if (FORBIDDEN_CHARS.test(entryPath)) return "Steuerzeichen, Rückwärtsstrich oder ungültiges UTF-8";
  if (Buffer.byteLength(entryPath, "utf8") > TREE_LIMITS.maxPathBytes) return "Pfad zu lang";
  const parts = entryPath.split("/");
  if (parts.length > TREE_LIMITS.maxDepth) return "zu tief verschachtelt";
  if (parts.some((p) => p === "" || p === "." || p === "..")) return "leerer, . oder .. -Teil";
  return null;
}

/** Zielpfad eines Symlinks: relativ, kanonisch. Liefert den Grund oder `null`. */
export function targetProblem(target: string): string | null {
  if (target === "" || target.startsWith("/")) return "leer oder absolut";
  if (FORBIDDEN_CHARS.test(target)) return "Steuerzeichen, Rückwärtsstrich oder ungültiges UTF-8";
  if (Buffer.byteLength(target, "utf8") > TREE_LIMITS.maxPathBytes) return "Ziel zu lang";
  const parts = target.split("/");
  let seenName = false;
  for (const part of parts) {
    if (part === "" || part === ".") return "leerer oder . -Teil";
    if (part === "..") {
      if (seenName) return ".. hinter einem Namen";
    } else seenName = true;
  }
  return seenName ? null : "zeigt nur auf Elternordner";
}

const BYTE_ORDER = (a: TreeEntry, b: TreeEntry) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8"));

/** Löst das Ziel eines Symlinks lexikalisch auf: Teile des aufgelösten Pfads, oder `null`, wenn es den Baum verlässt. */
export function resolveTarget(linkPath: string, target: string): string[] | null {
  const dir = linkPath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") {
      if (dir.length === 0) return null;
      dir.pop();
    } else dir.push(part);
  }
  return dir;
}

// ───────── Prüfung einer Liste, Serialisierung, Lesen ─────────

/** Stimmt die (sortierte) Liste in sich? Wirft `TreeError`. */
export function assertConsistent(entries: readonly TreeEntry[]): void {
  if (entries.length > TREE_LIMITS.maxEntries) throw new TreeError("limit", `Mehr als ${TREE_LIMITS.maxEntries} Einträge`);
  const kinds = new Map<string, TreeEntry["type"]>();
  let previous: Buffer | null = null;
  for (const entry of entries) {
    const problem = pathProblem(entry.path);
    if (problem) throw new TreeError("name", problem, entry.path);
    const bytes = Buffer.from(entry.path, "utf8");
    if (previous && Buffer.compare(previous, bytes) >= 0) throw new TreeError("format", "nicht streng aufsteigend sortiert", entry.path);
    previous = bytes;
    const slash = entry.path.lastIndexOf("/");
    if (slash >= 0 && kinds.get(entry.path.slice(0, slash)) !== "d") throw new TreeError("format", "Elternordner fehlt oder ist kein Ordner", entry.path);
    if (entry.path === TREE_FILE || entry.path === SEAL_FILE) throw new TreeError("name", "Name ist der Liste und dem Siegel vorbehalten", entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > TREE_LIMITS.maxFileSize) throw new TreeError("limit", "Größe außerhalb des erlaubten Bereichs", entry.path);
    if (entry.type === "f") {
      if (!entry.hash || !/^[0-9a-f]{128}$/.test(entry.hash)) throw new TreeError("format", "Hash fehlt oder ist ungültig", entry.path);
    } else {
      if (entry.exec) throw new TreeError("format", "Ausführbit nur bei Dateien", entry.path);
      if (entry.size !== 0) throw new TreeError("format", "Größe muss 0 sein", entry.path);
      if (entry.hash !== undefined) throw new TreeError("format", "Hash nur bei Dateien", entry.path);
    }
    if (entry.type === "l") {
      const bad = entry.target === undefined ? "Ziel fehlt" : targetProblem(entry.target);
      if (bad) throw new TreeError("link", bad, entry.path);
    } else if (entry.target !== undefined) throw new TreeError("format", "Ziel nur bei Symlinks", entry.path);
    kinds.set(entry.path, entry.type);
  }
  // Symlink-Ziele: im Baum, und der aufgelöste Weg führt nicht über einen weiteren Symlink
  for (const entry of entries) {
    if (entry.type !== "l") continue;
    const resolved = resolveTarget(entry.path, entry.target!);
    if (!resolved) throw new TreeError("link", "Ziel verlässt den Baum", entry.path);
    for (let i = 1; i < resolved.length; i++) {
      if (kinds.get(resolved.slice(0, i).join("/")) === "l") throw new TreeError("link", "Ziel führt über einen weiteren Symlink", entry.path);
    }
  }
}

/** Sortiert (nach Pfad-Bytes), prüft und serialisiert. */
export function serializeTree(input: readonly TreeEntry[]): Buffer {
  const entries = [...input].sort(BYTE_ORDER);
  assertConsistent(entries);
  const lines = entries.map((e) => {
    const field = e.type === "f" ? e.hash! : e.type === "l" ? e.target! : "-";
    return `${e.type}\t${e.type === "f" && e.exec ? "x" : "-"}\t${e.size}\t${field}\t${e.path}\n`;
  });
  const out = Buffer.from(TREE_HEADER + lines.join(""), "utf8");
  if (out.length > TREE_LIMITS.maxTreeBytes) throw new TreeError("limit", "Liste zu groß");
  return out;
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** Liest eine Liste streng; wirft `TreeError("format" | …)`. Der Aufrufer prüft vorher den Hash gegen das Siegel. */
export function parseTree(buffer: Buffer): TreeEntry[] {
  if (buffer.length > TREE_LIMITS.maxTreeBytes) throw new TreeError("limit", "Liste zu groß");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new TreeError("format", "kein gültiges UTF-8");
  }
  if (!text.startsWith(TREE_HEADER)) throw new TreeError("format", "Kopfzeilen fehlen oder weichen ab");
  const body = text.slice(TREE_HEADER.length);
  if (body === "") return [];
  if (!body.endsWith("\n")) throw new TreeError("format", "letzte Zeile ohne Zeilenende");
  const entries: TreeEntry[] = [];
  for (const line of body.slice(0, -1).split("\n")) {
    const fields = line.split("\t");
    if (fields.length !== 5) throw new TreeError("format", "Zeile hat nicht fünf Felder", fields[4] ?? line.slice(0, 80));
    const [type, execField, sizeField, field, entryPath] = fields;
    if (type !== "d" && type !== "f" && type !== "l") throw new TreeError("format", "unbekannter Typ", entryPath);
    if (execField !== "x" && execField !== "-") throw new TreeError("format", "Ausführbit muss x oder - sein", entryPath);
    if (!DECIMAL.test(sizeField) || sizeField.length > 13) throw new TreeError("format", "Größe ist keine Dezimalzahl", entryPath);
    const entry: TreeEntry = { type, exec: execField === "x", size: Number(sizeField), path: entryPath };
    if (type === "f") entry.hash = field;
    else if (type === "l") entry.target = field;
    else if (field !== "-") throw new TreeError("format", "Ordner tragen ‚-‘ im Hashfeld", entryPath);
    entries.push(entry);
    if (entries.length > TREE_LIMITS.maxEntries) throw new TreeError("limit", "zu viele Einträge");
  }
  assertConsistent(entries);
  return entries;
}

export const treeStats = (entries: readonly TreeEntry[]) => ({ entries: entries.length, bytes: entries.reduce((sum, e) => sum + (e.type === "f" ? e.size : 0), 0) });

export const sha512Hex = (data: Buffer) => createHash("sha512").update(data).digest("hex");

// ───────── Generator ─────────

/**
 * Erzeugt die Liste aus einem Baum. Verbotene Dinge (Sonderdateien, Setid, unzulässige Namen, Links aus dem Baum) brechen **laut** ab – der Bau scheitert,
 * statt dass ein Paket entsteht, das der Starter später ablehnt.
 */
export async function generateTree(fs: FsLike): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > TREE_LIMITS.maxDepth) throw new TreeError("limit", "zu tief verschachtelt", dir);
    for (const name of (await fs.readdir(dir)).sort()) {
      const rel = dir === "" ? name : `${dir}/${name}`;
      if (dir === "" && (name === TREE_FILE || name === SEAL_FILE)) {
        const own = await fs.lstat(rel);
        if (own?.kind !== "file") throw new TreeError("type", `${name} muss eine reguläre Datei sein`, rel);
        continue;
      }
      const problem = pathProblem(rel);
      if (problem) throw new TreeError("name", problem, rel);
      const st = await fs.lstat(rel);
      if (!st) throw new TreeError("io", "verschwunden während der Erzeugung", rel);
      if (st.mode & 0o7000) throw new TreeError("setid", "Setuid, Setgid oder Sticky gesetzt", rel);
      if (entries.length >= TREE_LIMITS.maxEntries) throw new TreeError("limit", `Mehr als ${TREE_LIMITS.maxEntries} Einträge`);
      if (st.kind === "dir") {
        entries.push({ type: "d", exec: false, size: 0, path: rel });
        await walk(rel, depth + 1);
      } else if (st.kind === "file") {
        const { sha512, size } = await fs.hash(rel);
        if (size !== st.size) throw new TreeError("io", "Größe änderte sich während der Erzeugung", rel);
        entries.push({ type: "f", exec: (st.mode & 0o111) !== 0, size, hash: sha512, path: rel });
      } else if (st.kind === "symlink") {
        entries.push({ type: "l", exec: false, size: 0, target: await fs.readlink(rel), path: rel });
      } else throw new TreeError("type", "weder Ordner, Datei noch Symlink", rel);
    }
  };
  await walk("", 1);
  entries.sort(BYTE_ORDER);
  assertConsistent(entries);
  return entries;
}

// ───────── Referenzprüfer: Liste ↔ Verzeichnis (Mengengleichheit) ─────────

export type TreeFailure = {
  /** Exit-Code des Prüfers (siehe README): 14 fehlt · 15 zusätzlich · 16 abweichend · 17 Ein-/Ausgabe */
  code: 14 | 15 | 16 | 17;
  reason: "missing" | "extra" | "type" | "size" | "hash" | "exec" | "setid" | "target" | "io";
  path: string;
};

/**
 * Vergleicht den Baum mit der Liste: **jeder** Eintrag der Liste ist vorhanden (gleicher Typ; Datei: Größe, Hash, Ausführbit; Symlink: Ziel), und **nichts**
 * ist darüber hinaus vorhanden (auch keine versteckten Dateien, leeren Ordner oder Sonderdateien). Es gibt keinen Ignorierbereich. Liefert den ersten Fund;
 * bei mehreren Abweichungen ist nur gesichert, dass abgelehnt wird (der Fund hängt von der Reihenfolge der Verzeichnisauflistung ab).
 */
export async function verifyTreeAgainstFs(fs: FsLike, entries: readonly TreeEntry[], onProgress?: (bytesRead: number) => void): Promise<TreeFailure | null> {
  const children = new Map<string, TreeEntry[]>();
  for (const entry of entries) {
    const slash = entry.path.lastIndexOf("/");
    const parent = slash < 0 ? "" : entry.path.slice(0, slash);
    const list = children.get(parent);
    if (list) list.push(entry);
    else children.set(parent, [entry]);
  }
  let bytesRead = 0;
  try {
    const walk = async (dir: string): Promise<TreeFailure | null> => {
      const expected = children.get(dir) ?? [];
      const byName = new Map(expected.map((e) => [e.path.slice(dir === "" ? 0 : dir.length + 1), e]));
      const actual = (await fs.readdir(dir)).sort();
      for (const name of actual) {
        const rel = dir === "" ? name : `${dir}/${name}`;
        if (dir === "" && (name === TREE_FILE || name === SEAL_FILE)) continue;
        if (!byName.has(name)) return { code: 15, reason: "extra", path: rel };
      }
      const present = new Set(actual);
      for (const [name, entry] of byName) {
        if (!present.has(name)) return { code: 14, reason: "missing", path: entry.path };
      }
      for (const entry of expected) {
        const st = await fs.lstat(entry.path);
        if (!st) return { code: 14, reason: "missing", path: entry.path };
        if (st.mode & 0o7000) return { code: 16, reason: "setid", path: entry.path };
        const kind = entry.type === "d" ? "dir" : entry.type === "f" ? "file" : "symlink";
        if (st.kind !== kind) return { code: 16, reason: "type", path: entry.path };
        if (entry.type === "d") {
          const sub = await walk(entry.path);
          if (sub) return sub;
        } else if (entry.type === "l") {
          if ((await fs.readlink(entry.path)) !== entry.target) return { code: 16, reason: "target", path: entry.path };
        } else {
          if (st.size !== entry.size) return { code: 16, reason: "size", path: entry.path };
          if (entry.exec && (st.mode & 0o111) === 0) return { code: 16, reason: "exec", path: entry.path };
          const { sha512, size } = await fs.hash(entry.path);
          bytesRead += size;
          onProgress?.(bytesRead);
          if (size !== entry.size) return { code: 16, reason: "size", path: entry.path };
          if (sha512 !== entry.hash) return { code: 16, reason: "hash", path: entry.path };
        }
      }
      return null;
    };
    return await walk("");
  } catch (error) {
    if (error instanceof TreeError && error.code === "io") return { code: 17, reason: "io", path: error.path ?? "" };
    throw error;
  }
}
