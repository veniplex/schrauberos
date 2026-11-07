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

/** Platz auf dem Datenträger des Datenverzeichnisses (`null`: das Dateisystem meldet ihn nicht – dann gibt es nichts zu bewerten). */
export type DiskHealthInput = { freeBytes: number; totalBytes: number };

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
  /** Aufgegebene Webhook-Zustellungen (Ziel lange nicht erreichbar) */
  | { code: "webhookDeadLetters"; count: number }
  /** Ziele, die die Anwendung selbst ausgeschaltet hat (410, Geheimnis unlesbar, Wiederherstellung) – Hinweis */
  | { code: "webhooksDisabled"; count: number }
  /** Zeitgeber nicht gestartet oder seit längerem ohne Takt */
  | { code: "runnerDown" }
  | { code: "runnerStale"; lastTickAt: Date }
  /** Vorbereitung/Takt des Zeitgebers scheitert (Datenbank?) */
  | { code: "runnerError" }
  /** Weniger als 10 % des Datenträgers frei (Hinweis) – siehe `DISK_WARN_FRACTION` */
  | { code: "diskLow"; freeBytes: number; totalBytes: number }
  /** Weniger als 5 % oder weniger als der Mindestplatz frei: Sicherungen, Uploads und Updates werden abgewiesen */
  | { code: "diskCritical"; freeBytes: number; totalBytes: number }
  /** Das neueste Backup ist älter als `BACKUP_MAX_AGE_DAYS` Tage (`ageDays`) oder es gibt keines (`null`) */
  | { code: "backupOld"; ageDays: number | null };

/** So lange darf ein fälliger Job auf seinen Lauf warten, bevor er als überfällig gilt (der Zeitgeber tickt alle 15 s). */
export const OVERDUE_MS = 5 * 60_000;
/** So lange darf der Zeitgeber ohne Takt bleiben (Takt alle 15 s). */
export const RUNNER_STALE_MS = 3 * 60_000;
/** Warnschwellen für den Plattenplatz: unter 10 % frei = Hinweis, unter 5 % oder unter dem Mindestplatz (`DISK_RESERVE_BYTES`, 512 MiB) = Fehler. */
export const DISK_WARN_FRACTION = 0.1;
export const DISK_CRITICAL_FRACTION = 0.05;
export const DISK_MIN_FREE_BYTES = 512 * 1024 * 1024;
/** So alt darf das neueste Backup werden, bevor der Systemstatus es meldet. */
export const BACKUP_MAX_AGE_DAYS = 7;

export function evaluateSystem(input: {
  now: Date;
  jobs: readonly JobHealthInput[];
  outboxFailed: number;
  /** Aufgegebene Webhook-Zustellungen; weglassen = nicht bewerten */
  webhookDeadLetters?: number;
  /** Von der Anwendung selbst ausgeschaltete Webhook-Ziele; weglassen = nicht bewerten */
  webhooksDisabled?: number;
  runner: RunnerHealthInput;
  /** Platz des Datenverzeichnisses; weglassen/`null` = nicht bewerten */
  disk?: DiskHealthInput | null;
  /** Zeitpunkt des neuesten Backups (`null` = es gibt keines); weglassen = nicht bewerten */
  newestBackupAt?: Date | null;
}): SystemProblem[] {
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
  if ((input.webhookDeadLetters ?? 0) > 0) problems.push({ code: "webhookDeadLetters", count: input.webhookDeadLetters! });
  if ((input.webhooksDisabled ?? 0) > 0) problems.push({ code: "webhooksDisabled", count: input.webhooksDisabled! });
  const { runner } = input;
  if (!runner.started) problems.push({ code: "runnerDown" });
  else if (runner.lastTickAt && now - runner.lastTickAt.getTime() > RUNNER_STALE_MS) problems.push({ code: "runnerStale", lastTickAt: runner.lastTickAt });
  if (runner.lastError) problems.push({ code: "runnerError" });
  const { disk } = input;
  if (disk && disk.totalBytes > 0) {
    const fraction = disk.freeBytes / disk.totalBytes;
    if (fraction < DISK_CRITICAL_FRACTION || disk.freeBytes < DISK_MIN_FREE_BYTES) problems.push({ code: "diskCritical", freeBytes: disk.freeBytes, totalBytes: disk.totalBytes });
    else if (fraction < DISK_WARN_FRACTION) problems.push({ code: "diskLow", freeBytes: disk.freeBytes, totalBytes: disk.totalBytes });
  }
  if (input.newestBackupAt !== undefined) {
    if (input.newestBackupAt === null) problems.push({ code: "backupOld", ageDays: null });
    else {
      const ageDays = Math.floor((now - input.newestBackupAt.getTime()) / 86_400_000);
      if (ageDays >= BACKUP_MAX_AGE_DAYS) problems.push({ code: "backupOld", ageDays });
    }
  }
  return problems;
}

/** Hinweise, die den Betrieb noch nicht stören: ein Übergangszustand (Neustart) oder wenig Platz. Alles andere ist ein Fehler. */
const WARNING_ONLY = new Set<SystemProblem["code"]>(["interrupted", "diskLow", "backupOld", "webhooksDisabled"]);

/** Schwere: `danger`, sobald etwas wirklich nicht läuft; `warning`, wenn es nur Hinweise sind (`WARNING_ONLY`). */
export const problemTone = (problems: readonly SystemProblem[]): "success" | "warning" | "danger" =>
  problems.length === 0 ? "success" : problems.every((p) => WARNING_ONLY.has(p.code)) ? "warning" : "danger";

/**
 * Hinweise zur Verbindung (reine Information, **keine** Störung – im Werkstattnetz ist HTTP üblich): unverschlüsselt geöffnet, und – wenn „Hinter Reverse-Proxy“ an ist – dass der Proxy dann
 * `X-Forwarded-Proto: https` mitgeben muss. Eigene Liste, damit „Alles in Ordnung“ davon unberührt bleibt.
 */
export type SystemNotice = { code: "insecure" } | { code: "proxyMismatch" };
export function connectionNotices(input: { secure: boolean; behindProxy: boolean }): SystemNotice[] {
  if (input.secure) return [];
  return input.behindProxy ? [{ code: "insecure" }, { code: "proxyMismatch" }] : [{ code: "insecure" }];
}
