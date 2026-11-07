import "server-only";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractArchive } from "@/lib/archive";
import { makeReadOnly, removeTreeSync, syncTree } from "@/lib/updates/fs-tree";
import { compareVersions } from "@/lib/updates/semver";
import { afterInstall } from "@/lib/updates/state";
import { pruneVersions, readMeta, readState, updatesDir, versionDir, versionsDir, writeState } from "@/lib/updates/store";
import { runningMeta, updaterEnabled } from "./config";
import { UpdateError, needsNewImage } from "./manifest";
import { verifyInstalledTree } from "./verify";
import { downloadAsset, type Release } from "./releases";

const LOCK_STALE_MS = 30 * 60 * 1000;

/** Obergrenzen beim Entpacken eines Pakets (App samt node_modules, Node und Bibliotheken; das gepackte Paket ist auf 400 MiB begrenzt). */
export const BUNDLE_ARCHIVE_LIMITS = { maxEntries: 200_000, maxBytes: 3 * 1024 ** 3 };

/** Nur ein Update gleichzeitig: Sperre als Verzeichnis (atomar), veraltete Sperren nach einem Absturz verfallen. */
function acquireLock(): () => void {
  const lock = path.join(updatesDir(), ".install.lock");
  mkdirSync(updatesDir(), { recursive: true });
  try {
    mkdirSync(lock);
  } catch {
    if (Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) throw new UpdateError("busy");
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
  }
  return () => rmSync(lock, { recursive: true, force: true });
}

/** Lädt das Paket in eine Datei und prüft dabei Größe und SHA-256 gegen das signierte Manifest. */
async function download(release: Release, file: string): Promise<void> {
  const res = await downloadAsset(release.bundle.url, 15 * 60_000);
  if (!res.ok || !res.body) throw new UpdateError("network", `HTTP ${res.status}`);

  const hash = createHash("sha256");
  let size = 0;
  const check = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > release.manifest.size) return callback(new UpdateError("tooLarge"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), check, createWriteStream(file));
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError("network");
  }
  if (size !== release.manifest.size || hash.digest("hex") !== release.manifest.sha256) throw new UpdateError("badChecksum");
}

/**
 * Installiert ein geprüftes Release in das Update-Volume und merkt es für den nächsten Start vor.
 * Die Anwendung selbst wird hier nicht beendet – das macht der Aufrufer nach der Antwort (scheduleRestart).
 */
export async function installRelease(release: Release): Promise<void> {
  if (!updaterEnabled()) throw new UpdateError("disabled");
  const running = runningMeta();
  if (needsNewImage(release.manifest, running)) throw new UpdateError("needsImage");
  if (compareVersions(release.version, running.version) <= 0) throw new UpdateError("notNewer");
  if (readState().pending) throw new UpdateError("pending");

  const unlock = acquireLock();
  const version = release.version;
  const tmp = path.join(updatesDir(), "tmp");
  const archive = path.join(tmp, release.manifest.asset);
  const staging = path.join(versionsDir(), `.partial-${version}`);
  try {
    rmSync(tmp, { recursive: true, force: true });
    removeTreeSync(staging);
    mkdirSync(tmp, { recursive: true });
    mkdirSync(staging, { recursive: true });

    await download(release, archive);

    try {
      // Das Paket ist signiert und geprüft – trotzdem nur Ordner, Dateien und Symlinks innerhalb des Pakets, keine gefährlichen Pfade, mit Obergrenzen (lib/archive.ts)
      await extractArchive(archive, staging, BUNDLE_ARCHIVE_LIMITS, { symlinks: "inside" });
    } catch {
      throw new UpdateError("extract");
    }

    const meta = readMeta(staging);
    const ok =
      meta &&
      meta.version === version &&
      meta.base === release.manifest.base &&
      existsSync(path.join(staging, "server.js")) &&
      existsSync(path.join(staging, "launcher.mjs")) &&
      existsSync(path.join(staging, "runtime", "node")) &&
      existsSync(path.join(staging, "runtime", "loader")) &&
      existsSync(path.join(staging, "prisma", "migrations"));
    if (!ok || !existsSync(path.join(staging, "SOS-TREE"))) throw new UpdateError("invalidBundle");

    // Siegel ablegen (es kommt als eigenes Release-Asset, nicht im Paket) und mit derselben Prüfung wie beim Start prüfen – **vor** der Aktivierung: Was installiert wird,
    // besteht die Prüfung des Starters. Scheitert sie, wird nichts aktiviert und der Zustand bleibt unberührt.
    writeFileSync(path.join(staging, "SOS-SEAL"), release.seal);
    const verdict = await verifyInstalledTree({ dir: staging, version, now: new Date() });
    if (!verdict.ok) {
      const code = verdict.code === 11 && verdict.reason === "endorsement-expired" ? "sealExpired" : verdict.code === 19 ? (verdict.reason === "floor" ? "notNewer" : "needsImage") : "badTree";
      throw new UpdateError(code, `Prüfung ${verdict.code} ${verdict.reason}${verdict.path ? ` ${verdict.path}` : ""}`);
    }

    // Haltbar machen (tar ruft kein fsync; nach einem Stromausfall dürfen Zustand und Dateien nicht auseinanderlaufen) und schreibschützen: ein Schreibversuch der
    // laufenden App in den Paketordner scheitert dann (EACCES) statt still eine Datei zu erzeugen, die die Prüfung beim nächsten Start scheitern ließe
    await syncTree(staging);
    await makeReadOnly(staging);

    const target = versionDir(version);
    removeTreeSync(target); // dieselbe Version erneut installieren (Reparatur) ersetzt die vorhandene, auch wenn sie schreibgeschützt ist
    renameSync(staging, target);

    const next = afterInstall(readState(), version);
    writeState(next);
    pruneVersions([next.current, next.previous].filter((v): v is string => !!v));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    removeTreeSync(staging);
    unlock();
  }
}
