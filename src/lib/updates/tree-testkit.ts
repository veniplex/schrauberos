/**
 * Dateisystem im Speicher für die Tests der Liste und des Prüfers (`tree.ts`, `seal.ts`): Es braucht weder Ausführbit-Unterstützung noch Symlink-Rechte des
 * Betriebssystems und läuft deshalb auch unter Windows. Nur für Tests – kein Produktivcode importiert diese Datei.
 */
import { createHash } from "node:crypto";
import { TreeError, type FsLike, type FsStat } from "./tree.ts";

export type MemNode = { kind: "file"; content: Buffer; mode: number } | { kind: "dir"; mode: number } | { kind: "symlink"; target: string } | { kind: "other"; mode: number };

export class MemoryFs implements FsLike {
  nodes = new Map<string, MemNode>();
  /** Ausfallsimulation: diese Pfade melden beim Zugriff einen Ein-/Ausgabefehler */
  failing = new Set<string>();
  /** Modus des Wurzelordners */
  rootMode = 0o755;

  file(path: string, content: Buffer | string, mode = 0o644): this {
    this.nodes.set(path, { kind: "file", content: Buffer.from(content), mode });
    return this;
  }
  dir(path: string, mode = 0o755): this {
    this.nodes.set(path, { kind: "dir", mode });
    return this;
  }
  link(path: string, target: string): this {
    this.nodes.set(path, { kind: "symlink", target });
    return this;
  }
  other(path: string, mode = 0o644): this {
    this.nodes.set(path, { kind: "other", mode });
    return this;
  }
  remove(path: string): this {
    for (const key of [...this.nodes.keys()]) if (key === path || key.startsWith(`${path}/`)) this.nodes.delete(key);
    return this;
  }
  clone(): MemoryFs {
    const copy = new MemoryFs();
    copy.rootMode = this.rootMode;
    for (const [key, node] of this.nodes) copy.nodes.set(key, node.kind === "file" ? { ...node, content: Buffer.from(node.content) } : { ...node });
    return copy;
  }

  private check(rel: string) {
    if (this.failing.has(rel)) throw new TreeError("io", "simulierter Ein-/Ausgabefehler", rel);
  }

  async lstat(rel: string): Promise<FsStat | null> {
    this.check(rel);
    if (rel === "") return { kind: "dir", size: 0, mode: this.rootMode };
    const node = this.nodes.get(rel);
    if (!node) return null;
    if (node.kind === "file") return { kind: "file", size: node.content.length, mode: node.mode };
    if (node.kind === "dir") return { kind: "dir", size: 0, mode: node.mode };
    if (node.kind === "symlink") return { kind: "symlink", size: node.target.length, mode: 0o777 };
    return { kind: "other", size: 0, mode: node.mode };
  }
  async readdir(rel: string): Promise<string[]> {
    this.check(rel);
    const prefix = rel === "" ? "" : `${rel}/`;
    const names = new Set<string>();
    for (const key of this.nodes.keys()) if (key.startsWith(prefix) && key.length > prefix.length) names.add(key.slice(prefix.length).split("/")[0]);
    return [...names];
  }
  async readlink(rel: string): Promise<string> {
    this.check(rel);
    const node = this.nodes.get(rel);
    if (node?.kind !== "symlink") throw new TreeError("io", "kein Symlink", rel);
    return node.target;
  }
  async hash(rel: string) {
    this.check(rel);
    const node = this.nodes.get(rel);
    if (node?.kind !== "file") throw new TreeError("io", "keine Datei", rel);
    return { sha512: createHash("sha512").update(node.content).digest("hex"), size: node.content.length };
  }
  async readFile(rel: string, maxBytes: number): Promise<Buffer | null> {
    this.check(rel);
    const node = this.nodes.get(rel);
    if (node?.kind !== "file") throw new TreeError("io", "keine Datei", rel);
    return node.content.length > maxBytes ? null : Buffer.from(node.content);
  }
}
