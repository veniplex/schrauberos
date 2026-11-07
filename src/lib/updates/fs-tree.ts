/**
 * Dateisystem-Hilfen für installierte Versionen unter `<DATA_DIR>/app/versions/<v>`: Haltbarkeit (fsync), Schreibschutz und Löschen schreibgeschützter Bäume.
 * Ohne Abhängigkeiten außer Node (auch vom Launcher genutzt).
 *
 * Ein geprüfter Baum wird **schreibgeschützt** (`a-w`: Ordner 0555, Dateien 0444/0555). Das ist keine Sicherheitsgrenze (der Besitzer kann `chmod`), schützt aber vor
 * versehentlicher Ablage: Ein Schreibversuch der laufenden App in den Paketordner scheitert dann mit EACCES wie im root-eigenen `/app`, statt still eine Datei zu erzeugen,
 * die die Prüfung beim nächsten Start scheitern ließe. Wer löschen will, braucht `removeTreeSync` (macht die Ordner erst wieder schreibbar).
 */
import { chmodSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { chmod, lstat, open, readdir } from "node:fs/promises";
import path from "node:path";

/** Macht alle Ordner unter (und einschließlich) `dir` für den Besitzer lesbar, schreibbar und durchsuchbar – Voraussetzung, um darin etwas zu löschen. Folgt keinem Symlink. */
function makeWritableSync(dir: string): void {
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  try {
    chmodSync(dir, (st.mode & 0o7777) | 0o700);
  } catch {
    /* gehört uns nicht: das anschließende Löschen meldet es */
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) makeWritableSync(path.join(dir, entry.name));
}

/** Löscht einen Baum, auch wenn er schreibgeschützt ist (und einen nicht vorhandenen ohne Fehler). */
export function removeTreeSync(target: string): void {
  makeWritableSync(target);
  rmSync(target, { recursive: true, force: true, maxRetries: 2 });
}

/** Alle Pfade unter `root` (Ordner nach ihrem Inhalt); Symlinks zählen als Datei, ihnen wird nie gefolgt. */
async function walk(root: string, visit: (full: string, kind: "dir" | "file" | "link", mode: number) => Promise<void>): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const st = await lstat(full);
    if (st.isSymbolicLink()) await visit(full, "link", st.mode);
    else if (st.isDirectory()) {
      await walk(full, visit);
      await visit(full, "dir", st.mode);
    } else await visit(full, "file", st.mode);
  }
}

const IGNORED_SYNC = new Set(["EINVAL", "EISDIR", "EPERM", "ENOTSUP", "ENOSYS", "EBADF", "EACCES"]);

/** `fsync` auf einer Datei oder einem Ordner; Plattformen, die das nicht können (Windows bei Ordnern), werden still übergangen. */
async function syncPath(full: string, directory: boolean): Promise<void> {
  let handle;
  try {
    handle = await open(full, "r");
    await handle.sync();
  } catch (error) {
    if (!IGNORED_SYNC.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    if (!directory && (error as NodeJS.ErrnoException).code === "EACCES") throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Bringt alle Dateien und Ordner eines frisch entpackten Baums auf den Datenträger (`tar.x` ruft kein `fsync`). Nach einem harten Stromausfall könnte sonst
 * `state.json` übernommen sein, die Dateien aber nur teilweise – die Integritätsprüfung würde die Version beim Neustart (zu Recht) ablehnen.
 */
export async function syncTree(root: string, concurrency = 32): Promise<void> {
  const paths: Array<{ full: string; directory: boolean }> = [];
  await walk(root, async (full, kind) => void (kind !== "link" && paths.push({ full, directory: kind === "dir" })));
  paths.push({ full: root, directory: true });
  for (let i = 0; i < paths.length; i += concurrency) await Promise.all(paths.slice(i, i + concurrency).map((p) => syncPath(p.full, p.directory)));
}

/** Entzieht allen Dateien und Ordnern unter `root` (einschließlich) das Schreibrecht. Symlinks bleiben unberührt. */
export async function makeReadOnly(root: string): Promise<void> {
  await walk(root, async (full, kind, mode) => {
    if (kind !== "link") await chmod(full, (mode & 0o7777) & ~0o222);
  });
  await chmod(root, ((await lstat(root)).mode & 0o7777) & ~0o222);
}
