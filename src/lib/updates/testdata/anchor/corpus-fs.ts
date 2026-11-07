/**
 * Brücken zwischen den Fällen des Goldkorpus (`cases.json`) und einem Dateisystem: im Speicher (für den TypeScript-Referenzprüfer, auch unter Windows) und als
 * echtes Verzeichnis (Linux; für den C-Prüfer in Teil 2 und für den Referenzprüfer auf dem echten Dateisystem).
 */
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { MemoryFs } from "../../tree-testkit.ts";
import { findNodeModulesAncestor } from "../../seal.ts";
import type { CorpusCase } from "./build-corpus.ts";

/** Der Baum der Version eines Falls im Speicher (Wurzel = Versionsordner). */
export function caseToMemoryFs(c: CorpusCase): MemoryFs {
  const prefix = `app/versions/${c.args.version}/`;
  const fs = new MemoryFs();
  for (const e of c.entries) {
    if (e.path === prefix.slice(0, -1)) fs.rootMode = e.mode;
    if (!e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    if (e.type === "f") fs.file(rel, Buffer.from(e.b64 ?? "", "base64"), e.mode);
    else if (e.type === "d") fs.dir(rel, e.mode);
    else if (e.type === "l") fs.link(rel, e.target ?? "");
    else fs.other(rel, e.mode);
  }
  return fs;
}

/** Ancestor-Prüfung im Speicher: gibt es oberhalb des Versionsordners (bis zum Datenverzeichnis `data`) einen Eintrag `node_modules`? */
export function caseAncestorProbe(c: CorpusCase): () => Promise<string | null> {
  const present = new Set(c.entries.map((e) => `/data/${e.path}`));
  return () => findNodeModulesAncestor(`/data/app/versions/${c.args.version}`, "/data", async (candidate) => present.has(candidate));
}

/** Legt einen Fall unterhalb von `dataDir` als echte Verzeichnisse an (Ausführbit, Setuid, Symlinks, FIFOs). Nur Linux. */
export function materializeCorpusCase(c: CorpusCase, dataDir: string): void {
  for (const e of c.entries) {
    const target = path.join(dataDir, ...e.path.split("/"));
    if (e.type === "d") {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      if (e.type === "f") writeFileSync(target, Buffer.from(e.b64 ?? "", "base64"));
      else if (e.type === "l") symlinkSync(e.target ?? "", target);
      else execFileSync("mkfifo", [target]);
    }
  }
  // Modi zuletzt (Ordner erst nach ihrem Inhalt; Symlinks haben keinen eigenen Modus)
  for (const e of [...c.entries].reverse()) {
    if (e.type === "l") continue;
    chmodSync(path.join(dataDir, ...e.path.split("/")), e.mode);
  }
}
