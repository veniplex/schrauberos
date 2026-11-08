import "server-only";
import { logError } from "@/lib/log-safe";
import { EVENT_KEEP_DAYS, HOURLY_KEEP_DAYS, MAX_CONCURRENT_CHECKS, RAW_KEEP_DAYS, compactSamples, nextState, type ProbeOutcome, type TargetState } from "@/lib/monitor/model";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { probeTarget, type ProbeDeps } from "./probe";

/**
 * Ablauf der Überwachung (Job `network.monitor`, `modules/it/network/jobs.ts`):
 *  - läuft nur, wenn die Überwachung **eingeschaltet** ist (Schalter in den Einstellungen der Funktion, standardmäßig aus) – ohne Ziele hat sie ohnehin keine Wirkung;
 *  - jedes **fällige** Ziel (`nextCheckAt <= jetzt`, eingeschaltet) wird **belegt**, indem sein Datum bedingt weitergeschoben wird (ein zweiter Läufer oder ein Neustart prüft nicht doppelt);
 *  - **fair**: das am längsten wartende Ziel zuerst, höchstens `MAX_CONCURRENT_CHECKS` (4) Prüfungen gleichzeitig, jede mit hartem Zeitlimit (5 s) – ein totes Ziel hält die anderen nicht auf
 *    und rückt nach seiner Prüfung ans Ende der Reihe; nach dem Zeitbudget des Laufs beginnt keine weitere Prüfung (der Rest ist beim nächsten Lauf als Erster dran);
 *  - das Ergebnis wird mit dem neuen Zustand (Entprellung) und gegebenenfalls einem Ausfall-/Wiederkehr-Ereignis in **einer** Transaktion geschrieben.
 * `now` gibt nur ein Test vor; sonst nimmt jede Prüfung die aktuelle Zeit.
 */
export const MONITOR_ENABLED_SETTING = "network.monitor.enabled";
const RUN_BUDGET_MS = 45_000;
const MAX_PER_RUN = 100;

export async function isMonitoringEnabled(): Promise<boolean> {
  return (await getSetting(MONITOR_ENABLED_SETTING)) === "true";
}

type DueTarget = { id: string; name: string; kind: string; host: string; port: number; path: string | null; method: string; ignoreTlsErrors: boolean; intervalSec: number; state: string; failStreak: number; stateSince: Date | null; nextCheckAt: Date };

const dueSelect = { id: true, name: true, kind: true, host: true, port: true, path: true, method: true, ignoreTlsErrors: true, intervalSec: true, state: true, failStreak: true, stateSince: true, nextCheckAt: true } as const;

/** Gibt es fällige Ziele? (Billige Vorabprüfung des Jobs: nur Lesezugriffe.) */
export async function hasDueTargets(now = new Date()): Promise<boolean> {
  if (!(await isMonitoringEnabled())) return false;
  return (await db.netMonitorTarget.count({ where: { enabled: true, nextCheckAt: { lte: now } }, take: 1 })) > 0;
}

export type RunSummary = { checked: number; up: number; down: number; skipped: number; errors: number };

export async function runDueChecks(options: { now?: Date; budgetMs?: number; signal?: AbortSignal; deps?: ProbeDeps; concurrency?: number; limit?: number; manual?: boolean } = {}): Promise<RunSummary> {
  const summary: RunSummary = { checked: 0, up: 0, down: 0, skipped: 0, errors: 0 };
  if (!(await isMonitoringEnabled())) return summary;
  const clock = () => options.now ?? new Date();
  const started = Date.now();
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;
  const limit = options.limit ?? MAX_PER_RUN;
  const stop = () => Boolean(options.signal?.aborted) || summary.checked + summary.skipped >= limit || Date.now() - started > budgetMs;

  // Reihenfolge: wer am längsten wartet, zuerst (die Reihe ist damit reihum: nach der Prüfung rückt ein Ziel ans Ende)
  const queue: DueTarget[] = await db.netMonitorTarget.findMany({ where: { enabled: true, nextCheckAt: { lte: clock() } }, orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }], take: limit, select: dueSelect });

  async function worker(): Promise<void> {
    for (let target = queue.shift(); target !== undefined; target = queue.shift()) {
      if (stop()) return;
      try {
        const claimedAt = clock();
        // Belegen: das Datum der nächsten Prüfung bedingt weiterschieben (nur wer es von „fällig“ weiterschiebt, prüft)
        const claim = await db.netMonitorTarget.updateMany({ where: { id: target.id, enabled: true, nextCheckAt: target.nextCheckAt }, data: { nextCheckAt: new Date(claimedAt.getTime() + target.intervalSec * 1000) } });
        if (claim.count === 0) {
          summary.skipped++;
          continue;
        }
        const outcome = await probeTarget(target, options.deps);
        // Abgebrochen (Zeitlimit des Jobs): das halbe Ergebnis wird nicht gebucht, das Ziel bleibt für den nächsten Lauf fällig
        if (options.signal?.aborted) {
          await db.netMonitorTarget.updateMany({ where: { id: target.id }, data: { nextCheckAt: target.nextCheckAt } });
          return;
        }
        await recordOutcome(target, outcome, clock());
        summary.checked++;
        if (outcome.ok) summary.up++;
        else summary.down++;
      } catch (error) {
        summary.errors++;
        logError("network:monitor", error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? MAX_CONCURRENT_CHECKS, queue.length) }, worker));
  return summary;
}

/** Bucht eine Messung: Rohwert, neuer Zustand (Entprellung), Ereignis bei Wechsel nach/aus „Ab“ – alles in einer Transaktion. */
export async function recordOutcome(target: Pick<DueTarget, "id" | "state" | "failStreak" | "stateSince" | "intervalSec">, outcome: ProbeOutcome, at: Date): Promise<TargetState> {
  const change = nextState({ state: target.state as TargetState, failStreak: target.failStreak }, outcome, target.intervalSec);
  const stateChanged = change.state !== target.state;
  const downSince = target.state === "down" ? target.stateSince : null;
  try {
    await db.$transaction([
      db.netMonitorSample.create({ data: { targetId: target.id, at, ok: outcome.ok, latencyMs: outcome.ok ? outcome.latencyMs : null, statusClass: outcome.statusClass } }),
      db.netMonitorTarget.update({
        where: { id: target.id },
        data: {
          state: change.state,
          failStreak: change.failStreak,
          stateSince: stateChanged ? at : (target.stateSince ?? at),
          lastCheckAt: at,
          lastLatencyMs: outcome.ok ? outcome.latencyMs : null,
          lastClass: outcome.statusClass,
          nextCheckAt: new Date(at.getTime() + change.nextInSeconds * 1000),
        },
      }),
      ...(change.event
        ? [db.netMonitorEvent.create({ data: { targetId: target.id, at, kind: change.event, downSeconds: change.event === "up" && downSince ? Math.max(0, Math.round((at.getTime() - downSince.getTime()) / 1000)) : null } })]
        : []),
    ]);
  } catch (error) {
    // Das Ziel wurde während der Prüfung gelöscht: nichts mehr zu buchen
    const code = (error as { code?: string }).code;
    if (code === "P2025" || code === "P2003") return change.state;
    throw error;
  }
  return change.state;
}

/**
 * Aufräumen (nachts): Rohwerte, die älter als 7 Tage sind, werden zu Stundenwerten verdichtet (addierend: eine Stunde, die schon Werte hat, wird ergänzt) und gelöscht; Stundenwerte nach 30 Tagen,
 * Zustandswechsel nach 90 Tagen. Wiederholbar: ein Lauf, der mittendrin endet, verliert nichts (erst verdichten, dann löschen – in einer Transaktion je Ziel).
 */
export async function pruneMonitor(now = new Date()): Promise<number> {
  const DAY = 86_400_000;
  const rawCut = new Date(now.getTime() - RAW_KEEP_DAYS * DAY);
  let removed = 0;
  const targets = await db.netMonitorSample.groupBy({ by: ["targetId"], where: { at: { lt: rawCut } } });
  for (const { targetId } of targets) {
    for (;;) {
      const rows = await db.netMonitorSample.findMany({ where: { targetId, at: { lt: rawCut } }, orderBy: { at: "asc" }, take: 5_000, select: { id: true, at: true, ok: true, latencyMs: true } });
      if (rows.length === 0) break;
      // Eine Stunde, die über zwei Stapel (oder zwei Läufe) verteilt ist, wird addierend ergänzt
      const buckets = compactSamples(rows);
      await db.$transaction([
        ...buckets.map((b) =>
          db.netMonitorHour.upsert({
            where: { targetId_hour: { targetId, hour: b.hour } },
            create: { targetId, hour: b.hour, checks: b.checks, failures: b.failures, latencySumMs: b.latencySumMs, latencyCount: b.latencyCount, latencyMaxMs: b.latencyMaxMs },
            update: { checks: { increment: b.checks }, failures: { increment: b.failures }, latencySumMs: { increment: b.latencySumMs }, latencyCount: { increment: b.latencyCount } },
          }),
        ),
        db.netMonitorSample.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
      ]);
      // Das Maximum einer ergänzten Stunde: nachziehen (increment kennt kein Maximum)
      for (const b of buckets) {
        if (b.latencyMaxMs === null) continue;
        await db.netMonitorHour.updateMany({ where: { targetId, hour: b.hour, OR: [{ latencyMaxMs: null }, { latencyMaxMs: { lt: b.latencyMaxMs } }] }, data: { latencyMaxMs: b.latencyMaxMs } });
      }
      removed += rows.length;
    }
  }
  removed += (await db.netMonitorHour.deleteMany({ where: { hour: { lt: new Date(now.getTime() - HOURLY_KEEP_DAYS * DAY) } } })).count;
  removed += (await db.netMonitorEvent.deleteMany({ where: { at: { lt: new Date(now.getTime() - EVENT_KEEP_DAYS * DAY) } } })).count;
  return removed;
}

/** Was an der Überwachung auffällt (Systemstatus): Ziele, die gerade „Ab“ sind – nur, wenn die Überwachung läuft. */
export async function monitorHealth(featureActive: boolean): Promise<{ down: number }> {
  if (!featureActive || !(await isMonitoringEnabled())) return { down: 0 };
  return { down: await db.netMonitorTarget.count({ where: { enabled: true, state: "down" } }) };
}
