import "server-only";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { compareVersions } from "@/lib/updates/semver";
import { afterInstall } from "@/lib/updates/state";
import { pruneVersions, readMeta, readState, updatesDir, versionDir, versionsDir, writeState } from "@/lib/updates/store";
import { runningMeta, updaterEnabled } from "./config";
import { UpdateError, needsNewImage } from "./manifest";
import { assetHeaders, type Release } from "./releases";

const LOCK_STALE_MS = 30 * 60 * 1000;

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
  let res: Response;
  try {
    res = await fetch(release.bundle.url, { headers: await assetHeaders(), signal: AbortSignal.timeout(15 * 60_000) });
  } catch {
    throw new UpdateError("network");
  }
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
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    mkdirSync(staging, { recursive: true });

    await download(release, archive);

    try {
      // Das Paket ist signiert und geprüft; node-tar schreibt nie außerhalb des Zielordners (auch nicht über Symlinks)
      await tar.x({ file: archive, cwd: staging, strict: true });
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
    if (!ok) throw new UpdateError("invalidBundle");

    const target = versionDir(version);
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);

    const next = afterInstall(readState(), version);
    writeState(next);
    pruneVersions([next.current, next.previous].filter((v): v is string => !!v));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
    unlock();
  }
}
