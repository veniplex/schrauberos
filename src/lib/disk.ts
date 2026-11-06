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
