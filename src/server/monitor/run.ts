import "server-only";
import { logError } from "@/lib/log-safe";
import { CHECK_TIMEOUT_MS, EVENT_KEEP_DAYS, HOURLY_KEEP_DAYS, MAX_CONCURRENT_CHECKS, RAW_KEEP_DAYS, compactSamples, nextState, viewOf, type ProbeOutcome, type TargetState } from "@/lib/monitor/model";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { probeTarget, type ProbeDeps } from "./probe";

/**
 * Ablauf der Überwachung (Job `network.monitor`, `modules/it/network/jobs.ts`):
 *  - läuft nur, wenn die Überwachung **eingeschaltet** ist (Schalter in den Einstellungen der Funktion, standardmäßig aus) – ohne Ziele hat sie ohnehin keine Wirkung;
 *  - jedes **fällige** Ziel (`nextCheckAt <= jetzt`, eingeschaltet) wird **belegt**, indem sein Datum bedingt weitergeschoben wird (ein zweiter Läufer oder ein Neustart prüft nicht doppelt) – aber nur um die
 *    **Haltedauer** der Prüfung (`CLAIM_LEASE_MS`), nicht um ein ganzes Intervall: bricht der Prozess mitten in der Prüfung ab, ist das Ziel nach Sekunden wieder dran, die Messung geht nicht verloren;
 *  - **fair**: das am längsten wartende Ziel zuerst, höchstens `MAX_CONCURRENT_CHECKS` (4) Prüfungen gleichzeitig, jede mit hartem Zeitlimit (5 s) – ein totes Ziel hält die anderen nicht auf
 *    und rückt nach seiner Prüfung ans Ende der Reihe; nach dem Zeitbudget des Laufs beginnt keine weitere Prüfung (der Rest ist beim nächsten Lauf als Erster dran);
 *  - das Ergebnis wird mit dem neuen Zustand (Entprellung) und gegebenenfalls einem Ausfall-/Wiederkehr-Ereignis in **einer** Transaktion geschrieben – und **nur, wenn das Ziel noch dieselbe
 *    Prüfkonfiguration hat** (Art, Host, Port, Pfad, Anfrage, Zertifikatsoption): wurde es während der Prüfung umadressiert, gehört das Ergebnis zur alten Adresse und wird verworfen (`recordOutcome`);
 *  - Messungen ändern **`updatedAt` des Ziels nie**: das Bearbeiten-Formular nutzt es als Version (Muster `updateLoginState`), eine Messung darf kein „von jemand anderem geändert“ auslösen.
 * `now` gibt nur ein Test vor; sonst nimmt jede Prüfung die aktuelle Zeit.
 */
export const MONITOR_ENABLED_SETTING = "network.monitor.enabled";
const RUN_BUDGET_MS = 45_000;
const MAX_PER_RUN = 100;
/** Haltedauer beim Belegen: länger als die längste Prüfung (Auflösung + Verbindung, `CHECK_TIMEOUT_MS`) mit Reserve, aber weit unter dem Intervall (≥ 60 s) */
export const CLAIM_LEASE_MS = 2 * CHECK_TIMEOUT_MS + 15_000;

export async function isMonitoringEnabled(): Promise<boolean> {
  return (await getSetting(MONITOR_ENABLED_SETTING)) === "true";
}

type DueTarget = { id: string; name: string; kind: string; host: string; port: number; path: string | null; method: string; ignoreTlsErrors: boolean; intervalSec: number; state: string; failStreak: number; stateSince: Date | null; nextCheckAt: Date; updatedAt: Date };

const dueSelect = { id: true, name: true, kind: true, host: true, port: true, path: true, method: true, ignoreTlsErrors: true, intervalSec: true, state: true, failStreak: true, stateSince: true, nextCheckAt: true, updatedAt: true } as const;

/** Was geprüft wird: der Schnappschuss, mit dem eine Messung gebucht wird, muss zur Zeile passen */
const CONFIG_FIELDS = ["kind", "host", "port", "path", "method", "ignoreTlsErrors"] as const;
type Config = Pick<DueTarget, (typeof CONFIG_FIELDS)[number]>;
const sameConfig = (a: Config, b: Config) => CONFIG_FIELDS.every((field) => a[field] === b[field]);

/** Gibt es fällige Ziele? (Billige Vorabprüfung des Jobs: nur Lesezugriffe.) */
export async function hasDueTargets(now = new Date()): Promise<boolean> {
  if (!(await isMonitoringEnabled())) return false;
  return (await db.netMonitorTarget.count({ where: { enabled: true, nextCheckAt: { lte: now } }, take: 1 })) > 0;
}

/** `wentDown`/`cameBack`: Zustandswechsel dieses Laufs – nur sie machen einen Lauf im Laufprotokoll des Job-Runners erwähnenswert */
export type RunSummary = { checked: number; up: number; down: number; skipped: number; errors: number; wentDown: number; cameBack: number };

export async function runDueChecks(options: { now?: Date; budgetMs?: number; signal?: AbortSignal; deps?: ProbeDeps; concurrency?: number; limit?: number; manual?: boolean } = {}): Promise<RunSummary> {
  const summary: RunSummary = { checked: 0, up: 0, down: 0, skipped: 0, errors: 0, wentDown: 0, cameBack: 0 };
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
        // Belegen: das Datum der nächsten Prüfung bedingt um die Haltedauer weiterschieben (nur wer es von „fällig“ weiterschiebt, prüft); `updatedAt` bleibt, wie es war. Hat sich die Zeile seit dem Lesen
        // geändert (Bearbeiten), wird sie in diesem Lauf übersprungen und ist beim nächsten wieder dran.
        const claim = await db.netMonitorTarget.updateMany({
          where: { id: target.id, enabled: true, nextCheckAt: target.nextCheckAt, updatedAt: target.updatedAt },
          data: { nextCheckAt: new Date(claimedAt.getTime() + Math.min(CLAIM_LEASE_MS, target.intervalSec * 1000)), updatedAt: target.updatedAt },
        });
        if (claim.count === 0) {
          summary.skipped++;
          continue;
        }
        const outcome = await probeTarget(target, options.deps);
        // Abgebrochen (Zeitlimit des Jobs): das halbe Ergebnis wird nicht gebucht, das Ziel bleibt für den nächsten Lauf fällig
        if (options.signal?.aborted) {
          await db.netMonitorTarget.updateMany({ where: { id: target.id, updatedAt: target.updatedAt }, data: { nextCheckAt: target.nextCheckAt, updatedAt: target.updatedAt } });
          return;
        }
        const recorded = await recordOutcome(target, outcome, clock());
        // Ein verworfenes Ergebnis (das Ziel wurde während der Prüfung umadressiert oder gelöscht) zählt nicht
        if (recorded.discarded) {
          summary.skipped++;
          continue;
        }
        summary.checked++;
        if (outcome.ok) summary.up++;
        else summary.down++;
        if (recorded.event === "down") summary.wentDown++;
        if (recorded.event === "up") summary.cameBack++;
      } catch (error) {
        summary.errors++;
        logError("network:monitor", error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? MAX_CONCURRENT_CHECKS, queue.length) }, worker));
  return summary;
}

export type RecordedOutcome = { state: TargetState; event: "down" | "up" | null; discarded: boolean };

/**
 * Bucht eine Messung: Rohwert, neuer Zustand (Entprellung), Ereignis bei Wechsel nach/aus „Ab“ – alles in einer Transaktion. Gebucht wird nur, wenn die Zeile **noch dieselbe Prüfkonfiguration** hat wie der
 * Schnappschuss, mit dem geprüft wurde: Wurde das Ziel inzwischen umadressiert (die Operation hat es auf „unbekannt“ zurückgesetzt), gehört das Ergebnis zur alten Adresse und wird verworfen (`discarded`).
 * Zustand, Fehlerzähler und Intervall nimmt die Buchung aus der Zeile selbst (nicht aus dem Schnappschuss); `updatedAt` bleibt unverändert (Version des Bearbeiten-Formulars).
 */
export async function recordOutcome(snapshot: Config & Pick<DueTarget, "id">, outcome: ProbeOutcome, at: Date): Promise<RecordedOutcome> {
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.netMonitorTarget.findUnique({
        where: { id: snapshot.id },
        select: { kind: true, host: true, port: true, path: true, method: true, ignoreTlsErrors: true, intervalSec: true, state: true, failStreak: true, stateSince: true, updatedAt: true },
      });
      // Gelöscht oder umadressiert: nichts mehr zu buchen
      if (!current) return { state: "unknown" as TargetState, event: null, discarded: true };
      if (!sameConfig(snapshot, current)) return { state: current.state as TargetState, event: null, discarded: true };
      const change = nextState({ state: current.state as TargetState, failStreak: current.failStreak }, outcome, current.intervalSec);
      const stateChanged = change.state !== current.state;
      const downSince = current.state === "down" ? current.stateSince : null;
      await tx.netMonitorSample.create({ data: { targetId: snapshot.id, at, ok: outcome.ok, latencyMs: outcome.ok ? outcome.latencyMs : null, statusClass: outcome.statusClass } });
      await tx.netMonitorTarget.update({
        where: { id: snapshot.id },
        data: {
          state: change.state,
          failStreak: change.failStreak,
          stateSince: stateChanged ? at : (current.stateSince ?? at),
          lastCheckAt: at,
          lastLatencyMs: outcome.ok ? outcome.latencyMs : null,
          lastClass: outcome.statusClass,
          nextCheckAt: new Date(at.getTime() + change.nextInSeconds * 1000),
          updatedAt: current.updatedAt,
        },
      });
      if (change.event) {
        await tx.netMonitorEvent.create({ data: { targetId: snapshot.id, at, kind: change.event, downSeconds: change.event === "up" && downSince ? Math.max(0, Math.round((at.getTime() - downSince.getTime()) / 1000)) : null } });
      }
      return { state: change.state, event: change.event, discarded: false };
    });
  } catch (error) {
    // Das Ziel wurde während der Prüfung gelöscht: nichts mehr zu buchen
    const code = (error as { code?: string }).code;
    if (code === "P2025" || code === "P2003") return { state: "unknown", event: null, discarded: true };
    throw error;
  }
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

/**
 * Was an der Überwachung auffällt (Systemstatus): Ziele, die gerade „Ab“ **und frisch gemessen** sind – nur, wenn die Überwachung läuft. Wie Liste, Dashboard und Gerätestatus rechnet sie mit `viewOf`: eine
 * veraltete Messung (der Job läuft nicht) ist „unbekannt“, kein Ausfall.
 */
export async function monitorHealth(featureActive: boolean, now = new Date()): Promise<{ down: number }> {
  if (!featureActive || !(await isMonitoringEnabled())) return { down: 0 };
  const targets = await db.netMonitorTarget.findMany({ where: { enabled: true, state: "down" }, select: { state: true, lastCheckAt: true, intervalSec: true } });
  return { down: targets.filter((t) => viewOf(t, now).state === "down").length };
}
