/**
 * Bewertung des Systemstatus: Was ist auffällig? Rein (ohne Datenbank und Uhr), damit sie testbar ist; die Seite „Systemstatus“ und – später – ein Dashboard-Baustein
 * zeigen dasselbe Ergebnis.
 *
 * „Alles in Ordnung“ heißt: kein Job in einer Fehlerserie, keiner überfällig oder mit abgelaufener Sperre hängend, keine aufgegebenen Ereignisse in der Outbox und ein
 * Zeitgeber, der tatsächlich tickt. Jobs ausgeschalteter Funktionen zählen nie (ihre alte Fehlserie ist ohne Bedeutung, solange die Funktion ruht).
 */

export type JobHealthInput = {
  id: string;
  /** Läuft der Job überhaupt (Funktion eingeschaltet)? */
  active: boolean;
  failures: number;
  lastStatus: string | null;
  nextRunAt: Date | null;
  lockedUntil: Date | null;
};

export type RunnerHealthInput = { started: boolean; prepared: boolean; lastTickAt: Date | null; lastError: string | null };

export type SystemProblem =
  /** Job in einer Fehlerserie */
  | { code: "failing"; jobId: string; failures: number }
  /** Job wartet seit längerem auf seinen Lauf, obwohl er fällig ist (Zeitgeber steht oder Job hängt) */
  | { code: "overdue"; jobId: string }
  /** Sperre abgelaufen, aber der Lauf nie abgeschlossen (hängender Lauf) */
  | { code: "stuck"; jobId: string }
  /** Letzter Lauf wurde durch einen Neustart unterbrochen und noch nicht wiederholt */
  | { code: "interrupted"; jobId: string }
  /** Aufgegebene Ereignisse in der Outbox */
  | { code: "outboxFailed"; count: number }
  /** Zeitgeber nicht gestartet oder seit längerem ohne Takt */
  | { code: "runnerDown" }
  | { code: "runnerStale"; lastTickAt: Date }
  /** Vorbereitung/Takt des Zeitgebers scheitert (Datenbank?) */
  | { code: "runnerError" };

/** So lange darf ein fälliger Job auf seinen Lauf warten, bevor er als überfällig gilt (der Zeitgeber tickt alle 15 s). */
export const OVERDUE_MS = 5 * 60_000;
/** So lange darf der Zeitgeber ohne Takt bleiben (Takt alle 15 s). */
export const RUNNER_STALE_MS = 3 * 60_000;

export function evaluateSystem(input: { now: Date; jobs: readonly JobHealthInput[]; outboxFailed: number; runner: RunnerHealthInput }): SystemProblem[] {
  const now = input.now.getTime();
  const problems: SystemProblem[] = [];
  // Vor dem ersten Takt (Startverzögerung) sind nach einer langen Pause alle Jobs „überfällig“ – das ist noch kein Fehler
  const ticking = input.runner.lastTickAt !== null;
  for (const job of input.jobs) {
    if (!job.active) continue;
    if (job.failures > 0) problems.push({ code: "failing", jobId: job.id, failures: job.failures });
    const lockExpired = job.lockedUntil !== null && job.lockedUntil.getTime() < now;
    if (lockExpired) problems.push({ code: "stuck", jobId: job.id });
    else if (ticking && job.lockedUntil === null && job.nextRunAt && now - job.nextRunAt.getTime() > OVERDUE_MS) problems.push({ code: "overdue", jobId: job.id });
    if (job.lastStatus === "interrupted" && job.failures === 0 && !lockExpired) problems.push({ code: "interrupted", jobId: job.id });
  }
  if (input.outboxFailed > 0) problems.push({ code: "outboxFailed", count: input.outboxFailed });
  const { runner } = input;
  if (!runner.started) problems.push({ code: "runnerDown" });
  else if (runner.lastTickAt && now - runner.lastTickAt.getTime() > RUNNER_STALE_MS) problems.push({ code: "runnerStale", lastTickAt: runner.lastTickAt });
  if (runner.lastError) problems.push({ code: "runnerError" });
  return problems;
}

/** Schwere: `danger`, sobald etwas wirklich nicht läuft; `warning` für Übergangszustände. */
export const problemTone = (problems: readonly SystemProblem[]): "success" | "warning" | "danger" =>
  problems.length === 0 ? "success" : problems.every((p) => p.code === "interrupted") ? "warning" : "danger";
