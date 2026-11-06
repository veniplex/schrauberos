import type { FeatureId } from "@/modules/catalog";
import type { Schedule } from "@/lib/jobs/schedule";

/**
 * Jobs und Ereignis-Abnehmer (Outbox) sind Beiträge der Funktionen: Jede Funktion legt eine `jobs.ts` an (`jobs`, `outboxHandlers`), eingesammelt in
 * `src/modules/jobs.ts`. Die Plattform (Runner) kennt keine Funktion – sie führt aus, was dort angemeldet ist, und nur, solange die Funktion aktiv ist.
 */

export type JobContext = {
  /** Beginn dieses Laufs */
  now: Date;
  /** Wird bei Zeitüberschreitung ausgelöst: lang laufende Jobs brechen dann ab, soweit möglich */
  signal: AbortSignal;
  /** Wievielter Versuch in Folge (1 = erster; steigt mit jedem Fehlschlag) */
  attempt: number;
};

/** Wiederholung nach einem Fehlschlag: Wartezeit = Basis · 2^(Fehlschläge − 1), höchstens `maxDelayMs`. Der Job gibt nie auf, er wird nur seltener versucht. */
export type JobRetry = { baseDelayMs: number; maxDelayMs: number };

export const DEFAULT_JOB_RETRY: JobRetry = { baseDelayMs: 60_000, maxDelayMs: 60 * 60_000 };
export const DEFAULT_JOB_TIMEOUT_MS = 30 * 60_000;

export type JobDef = {
  /** Eindeutig, `<bereich>.<name>`, z. B. "backup.auto"; Schlüssel für Zustand, Ergebnisse und Beschriftung (`jobs.names.<id>`) */
  id: string;
  /** Funktion, der der Job gehört: er läuft nur, solange sie aktiv ist. Ohne Angabe: Plattform (läuft immer) */
  feature?: FeatureId;
  schedule: Schedule;
  retry?: JobRetry;
  /** Obergrenze für einen Lauf (Standard 30 Minuten) */
  timeoutMs?: number;
  /**
   * Führt den Job aus. Muss **wiederholbar** sein (ein Neustart mitten im Lauf holt ihn nach) und wirft bei Fehlern. Die Rückgabe ist eine kurze Ergebnismeldung
   * für die Statusansicht (keine Nutzdaten, keine Geheimnisse).
   */
  run: (ctx: JobContext) => Promise<string | void>;
};

/** Ein Ereignis aus der Outbox, wie es der Abnehmer sieht. */
export type OutboxMessage = {
  /** Eindeutige Ereignis-ID – Schlüssel für Idempotenz beim Empfänger (Zustellung ist „mindestens einmal“) */
  id: string;
  type: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  actorId: string | null;
  createdAt: Date;
  /** Wievielter Zustellversuch dieses Ereignisses (1 = erster) */
  attempt: number;
};

export type OutboxHandlerDef = {
  /** Eindeutig, `<bereich>.<name>`: bereits bediente Abnehmer werden bei einer Wiederholung übersprungen */
  id: string;
  /** Funktion, der der Abnehmer gehört: ist sie ausgeschaltet, wird nichts zugestellt (das Ereignis gilt dann für diesen Abnehmer als erledigt) */
  feature?: FeatureId;
  /** Ereignistypen: exakt ("invoice.paid"), Präfix mit Stern am Ende ("invoice.*") oder "*" */
  types: readonly string[];
  /** Fehlversuche, bevor das Ereignis als fehlgeschlagen gilt (Standard 8) */
  maxAttempts?: number;
  /** Stellt zu; wirft bei Fehlern (dann folgt eine Wiederholung mit Wartezeit). Wird mindestens einmal aufgerufen – idempotent über `message.id`. */
  handle: (message: OutboxMessage) => Promise<void>;
};
