import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as appDb } from "@/server/db";
import { AUTO_VACUUM_INCREMENTAL } from "@/server/migrate";

/**
 * Freie Seiten der Datenbank zurückgeben (Job `platform.incremental-vacuum`, nachts nach den Aufbewahrungsjobs).
 *
 * Die Datenbank läuft mit `auto_vacuum = INCREMENTAL` (siehe `AUTO_VACUUM_INCREMENTAL` in `server/migrate.ts`): Löschen (Messwerte, Zustellprotokoll, Mail, Audit, Backups der Zeilen)
 * gibt Seiten nur auf die Freiliste, die Datei schrumpft erst mit `PRAGMA incremental_vacuum(N)`. Das Freigeben ist begrenzt (Seiten je Lauf, Zeit je Lauf) und geschieht in kleinen
 * Schritten, zwischen denen andere Zugriffe drankommen – nie ein langes `VACUUM` mit doppeltem Platzbedarf. Eine Datenbank mit anderer Betriebsart (z. B. von Hand angelegt) bleibt unberührt.
 * Der Job ist wiederholbar (ein Abbruch mittendrin hat nur weniger freigegeben) und wirft bei Fehlern – der Systemstatus zeigt sie.
 */

/** Seiten je Schritt (bei 4 KiB: 8 MiB) und höchstens je Lauf (160 MiB); danach holt der nächste Lauf den Rest. */
export const VACUUM_PAGES_PER_STEP = 2000;
export const VACUUM_PAGES_PER_RUN = 40_000;
/** Zeitbudget eines Laufs in Millisekunden */
export const VACUUM_BUDGET_MS = 2 * 60_000;

type Client = Pick<PrismaClient, "$queryRawUnsafe">;

async function pragma(client: Client, statement: string, column: string): Promise<number> {
  const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(`PRAGMA ${statement}`);
  return Number(rows[0]?.[column] ?? 0);
}

/** Betriebsart und Zahl der freien Seiten (nur lesend). */
export async function databaseSpace(client: Client = appDb): Promise<{ mode: number; freePages: number; pageSize: number }> {
  return {
    mode: await pragma(client, "auto_vacuum", "auto_vacuum"),
    freePages: await pragma(client, "freelist_count", "freelist_count"),
    pageSize: await pragma(client, "page_size", "page_size"),
  };
}

export type VacuumResult = { released: number; remaining: number; bytes: number; skipped?: "mode" };

export async function runIncrementalVacuum(options: { maxPages?: number; stepPages?: number; budgetMs?: number; signal?: AbortSignal; client?: Client; now?: () => number } = {}): Promise<VacuumResult> {
  const client = options.client ?? appDb;
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? VACUUM_PAGES_PER_RUN));
  const step = Math.max(1, Math.min(100_000, Math.floor(options.stepPages ?? VACUUM_PAGES_PER_STEP)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? VACUUM_BUDGET_MS);

  const start = await databaseSpace(client);
  if (start.mode !== AUTO_VACUUM_INCREMENTAL) return { released: 0, remaining: start.freePages, bytes: 0, skipped: "mode" };
  let free = start.freePages;
  let released = 0;
  while (free > 0 && released < maxPages && now() < deadline && !options.signal?.aborted) {
    await client.$queryRawUnsafe(`PRAGMA incremental_vacuum(${Math.min(step, maxPages - released)})`);
    const after = await pragma(client, "freelist_count", "freelist_count");
    if (after >= free) break; // nichts mehr freizugeben (z. B. Seiten, die nur im WAL hängen)
    released += free - after;
    free = after;
    // zwischen den Schritten die Ereignisschleife und andere Datenbankzugriffe dranlassen
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  // die Datei schrumpft erst, wenn das WAL zurückgeschrieben ist (nicht blockierend: laufende Leser bremsen das nur)
  if (released > 0) await client.$queryRawUnsafe("PRAGMA wal_checkpoint(PASSIVE)");
  return { released, remaining: free, bytes: released * start.pageSize };
}

/** Meldung für die Statusansicht (nur Zahlen). */
export function describeVacuum(result: VacuumResult): string | undefined {
  if (result.skipped === "mode") return "übersprungen (Datenbank ohne inkrementelles Aufräumen)";
  if (result.released === 0) return undefined;
  const mib = Math.round((result.bytes / 1_048_576) * 10) / 10;
  return `${result.released} Seiten (${mib} MiB) freigegeben${result.remaining > 0 ? `, ${result.remaining} verbleiben` : ""}`;
}
