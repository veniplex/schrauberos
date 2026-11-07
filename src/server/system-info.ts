import "server-only";
import { statSync } from "node:fs";
import { diskSpace, type DiskSpace } from "@/lib/disk";
import type { VersionMeta } from "@/lib/updates/state";
import { dataDir, readMeta } from "@/lib/updates/store";
import { listBackups, type BackupInfo } from "@/server/backup/core";
import { databaseFile } from "@/server/db-client";

/**
 * Angaben für den Systemstatus (P1b-7): Plattenplatz des Datenverzeichnisses, Größe der Datenbank (Datei und Write-Ahead-Log), neuestes Backup, Version und Laufzeit.
 * Nur lesend, ohne Nutzdaten; jede Angabe fällt einzeln auf `null` zurück, wenn sie sich nicht ermitteln lässt (die Seite bleibt benutzbar).
 */

export type DatabaseSize = { fileBytes: number; walBytes: number; totalBytes: number };

const sizeOf = (file: string): number => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

/** Größe der SQLite-Datei und ihres Write-Ahead-Logs (`-wal`; `-shm` ist nur ein Index im Speicher und zählt nicht); `null`, wenn die Datei nicht existiert. */
export function databaseSize(file = databaseFile()): DatabaseSize | null {
  try {
    const fileBytes = statSync(file).size;
    const walBytes = sizeOf(`${file}-wal`);
    return { fileBytes, walBytes, totalBytes: fileBytes + walBytes };
  } catch {
    return null;
  }
}

export type BuildInfo = { version: string; commit: string | null; node: string; arch: string; base: number | null; packaged: boolean };

/** Version des laufenden Codes: aus `version.json` (Paket und Image); in der Entwicklung ohne Datei ein Platzhalter. Die Node-Version ist die des **laufenden** Prozesses. */
export function buildInfo(meta: VersionMeta | null = readMeta(process.cwd())): BuildInfo {
  return {
    version: meta?.version ?? "0.0.0-dev",
    commit: meta?.commit ?? null,
    node: process.version.replace(/^v/, ""),
    arch: process.arch,
    base: meta?.base ?? null,
    packaged: meta !== null,
  };
}

export type SystemInfo = { disk: DiskSpace | null; database: DatabaseSize | null; newestBackup: BackupInfo | null; build: BuildInfo };

export async function systemInfo(): Promise<SystemInfo> {
  const [disk, backups] = await Promise.all([diskSpace(dataDir()), listBackups().catch(() => [] as BackupInfo[])]);
  return { disk, database: databaseSize(), newestBackup: backups[0] ?? null, build: buildInfo() };
}
