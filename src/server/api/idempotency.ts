import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { apiRuntime } from "./state";

/**
 * Idempotenz (`Idempotency-Key`): Eine Wiederholung derselben schreibenden Anfrage (Netzwerkabbruch, Timeout) darf nichts doppelt anlegen.
 *
 *  - Schlüssel gelten **je Token und je Pfad** (`<Methode> <Pfad>`), 24 Stunden lang.
 *  - Der Körper wird gehasht. Gleicher Schlüssel + anderer Körper → 422 (Schlüssel wiederverwendet).
 *  - Gleicher Schlüssel + gleicher Körper → die gespeicherte Antwort wird wiederholt (Header `Idempotent-Replayed: true`), die Operation läuft nicht noch einmal.
 *  - **Parallele Doppelanfragen:** Die erste legt die Zeile an (Unique `tokenId+scope+key`), jede weitere scheitert daran und bekommt 409 „in Arbeit“,
 *    solange die erste läuft. Eine Zeile ohne Antwort, die älter ist als `STALE_MS`, gilt als verwaist (Absturz) und wird übernommen.
 *  - Gespeichert werden Antworten unter 500 (außer 429); bei Serverfehlern wird die Zeile freigegeben, damit die Wiederholung erneut laufen darf.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
export const STALE_MS = 60_000;
/** Erlaubte Schlüssel: 1–128 Zeichen aus Buchstaben, Ziffern und `._:~-` (z. B. eine UUID). */
export const IDEMPOTENCY_KEY_SHAPE = /^[A-Za-z0-9._:~-]{1,128}$/;

export const hashBody = (text: string): string => createHash("sha256").update(text).digest("hex");

export type Stored = { status: number; body: string; headers: Record<string, string> };
export type Reservation = { kind: "run"; id: string } | { kind: "replay"; stored: Stored } | { kind: "mismatch" } | { kind: "busy" };

const isDuplicate = (error: unknown): boolean => error instanceof Error && (error as { code?: unknown }).code === "P2002";

export async function reserveIdempotency(input: { tokenId: string; scope: string; key: string; bodyHash: string }): Promise<Reservation> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = apiRuntime.now();
    try {
      const row = await db.apiIdempotencyKey.create({ data: { ...input, createdAt: new Date(now), expiresAt: new Date(now + IDEMPOTENCY_TTL_MS) }, select: { id: true } });
      return { kind: "run", id: row.id };
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
    const existing = await db.apiIdempotencyKey.findUnique({ where: { tokenId_scope_key: { tokenId: input.tokenId, scope: input.scope, key: input.key } } });
    if (!existing) continue; // zwischenzeitlich freigegeben: nochmal versuchen
    if (existing.expiresAt.getTime() <= now) {
      await db.apiIdempotencyKey.deleteMany({ where: { id: existing.id, expiresAt: { lte: new Date(now) } } });
      continue;
    }
    if (existing.bodyHash !== input.bodyHash) return { kind: "mismatch" };
    if (existing.status === null) {
      if (now - existing.createdAt.getTime() > STALE_MS) {
        await db.apiIdempotencyKey.deleteMany({ where: { id: existing.id, status: null } });
        continue;
      }
      return { kind: "busy" };
    }
    return { kind: "replay", stored: { status: existing.status, body: existing.response ?? "", headers: existing.headers ? (JSON.parse(existing.headers) as Record<string, string>) : {} } };
  }
  return { kind: "busy" };
}

/** Antwort zur Wiederholung festhalten. */
export async function completeIdempotency(id: string, stored: Stored): Promise<void> {
  await db.apiIdempotencyKey.updateMany({ where: { id }, data: { status: stored.status, response: stored.body, headers: JSON.stringify(stored.headers) } });
}

/** Schlüssel freigeben (Serverfehler: die Wiederholung soll erneut ausgeführt werden). */
export async function releaseIdempotency(id: string): Promise<void> {
  await db.apiIdempotencyKey.deleteMany({ where: { id } });
}

/** Abgelaufene Schlüssel löschen (Scheduler); liefert die Anzahl. */
export async function pruneIdempotency(now = apiRuntime.now()): Promise<number> {
  return (await db.apiIdempotencyKey.deleteMany({ where: { expiresAt: { lte: new Date(now) } } })).count;
}
