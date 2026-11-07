import { statfs } from "node:fs/promises";

let override: ((dir: string) => Promise<number | null>) | null = null;

/** Nur für Tests: ersetzt die Abfrage des freien Platzes (`null` = zurück zur echten). */
export function setFreeBytesForTest(fn: ((dir: string) => Promise<number | null>) | null): void {
  override = fn;
}

/** Freier Platz (für nicht privilegierte Prozesse) auf dem Datenträger, auf dem `dir` liegt; null, wenn das Dateisystem es nicht meldet. */
export async function freeBytes(dir: string): Promise<number | null> {
  if (override) return override(dir);
  try {
    const s = await statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    return Number.isFinite(free) ? free : null;
  } catch {
    return null;
  }
}

/** Mindestens so viel Platz soll nach einem Upload oder Entpacken frei bleiben (Datenbank, Sitzungen, Protokolle brauchen auch Platz). */
export const DISK_RESERVE_BYTES = 512 * 1024 * 1024;

export type DiskSpace = { freeBytes: number; totalBytes: number };
let spaceOverride: ((dir: string) => Promise<DiskSpace | null>) | null = null;

/** Nur für Tests: ersetzt die Abfrage von freiem und gesamtem Platz (`null` = zurück zur echten). */
export function setDiskSpaceForTest(fn: ((dir: string) => Promise<DiskSpace | null>) | null): void {
  spaceOverride = fn;
}

/** Freier (für nicht privilegierte Prozesse) und gesamter Platz des Datenträgers, auf dem `dir` liegt; null, wenn das Dateisystem ihn nicht meldet (Systemstatus). */
export async function diskSpace(dir: string): Promise<DiskSpace | null> {
  if (spaceOverride) return spaceOverride(dir);
  try {
    const s = await statfs(dir);
    const freeBytes = Number(s.bavail) * Number(s.bsize);
    const totalBytes = Number(s.blocks) * Number(s.bsize);
    return Number.isFinite(freeBytes) && Number.isFinite(totalBytes) && totalBytes > 0 ? { freeBytes, totalBytes } : null;
  } catch {
    return null;
  }
}
