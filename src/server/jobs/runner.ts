import "server-only";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { backoffDelay, nextRun, validateSchedule } from "@/lib/jobs/schedule";
import { describeError, logError, stripControl } from "@/lib/log-safe";
import { FEATURES, MODULES } from "@/modules/catalog";
import { effectiveFeatureIds } from "@/modules/catalog-logic";
import { db as appDb } from "@/server/db";
import { DEFAULT_JOB_RETRY, DEFAULT_JOB_TIMEOUT_MS, type JobDef } from "./types";

/**
 * Job-Runner: führt die geplanten Jobs der Plattform und der Funktionen aus. Der Zustand liegt in der Datenbank (`JobState`, `JobRun`) und überlebt damit
 * Neustarts; die Definitionen (Zeitplan, Code) stehen im Code.
 *
 *  - **Zeitplan:** Intervall oder Cron in der Zeitzone der Werkstatt (siehe `lib/jobs/schedule.ts`); verpasste Läufe (App war aus) werden einmal nachgeholt.
 *  - **Fehler:** `failures` zählt Fehlschläge in Folge; der nächste Versuch kommt nach einer Wartezeit, die sich je Fehlschlag verdoppelt (mit Obergrenze,
 *    siehe `JobRetry`). Ein Job gibt nie still auf: Der Fehler bleibt in `JobState`/`JobRun` sichtbar, bis ein Lauf gelingt.
 *  - **Sperre gegen Doppelläufe:** Vor dem Lauf wird der Job in der Datenbank belegt (`lockedUntil`, bedingtes Update); ein zweiter Zugriff – auch aus
 *    einem zweiten Takt – scheitert daran. Zusätzlich merkt sich der Prozess laufende Jobs, bis die Funktion wirklich zurückkehrt (auch nach Zeitüberschreitung).
 *  - **Neustart mitten im Lauf:** Es läuft nur ein Prozess (ein Container). `recover()` beim Start markiert daher alle noch „laufenden“ Läufe als unterbrochen,
 *    gibt die Sperren frei und setzt die Jobs auf „sofort“ – die Jobs sind wiederholbar. Läuft versehentlich ein zweiter Prozess, ist `recover()` nicht sicher.
 *  - **Funktion ausgeschaltet:** Der Job ruht (kein Lauf, kein Eintrag); beim Wiedereinschalten wird er nachgeholt.
 *  - **Testbar:** Uhr, Zeitzone, Aktivierung und Job-Liste werden hineingereicht; `tick()` führt fällige Jobs aus, ohne Zeitgeber.
 */

type Client = Pick<PrismaClient, "jobState" | "jobRun" | "featureSetting">;

export type RunnerOptions = {
  jobs: () => readonly JobDef[];
  db?: Client;
  now?: () => Date;
  /** Zeitzone für Cron-Zeitpläne (Standard: die des Prozesses, die die App aus den Werkstatt-Einstellungen setzt) */
  timeZone?: () => string;
  /** Welche Funktionen sind aktiv? (Standard: Schalter aus der Datenbank) */
  activeFeatures?: () => Promise<ReadonlySet<string>>;
  /** Verzögerung vor dem ersten Takt nach dem Start (Standard 60 s, wie bisher der Zeitgeber) */
  startDelayMs?: number;
  /** Abstand der Takte (Standard 15 s) */
  tickMs?: number;
};

export type RunResult = { jobId: string; status: "ok" | "error"; message: string; durationMs: number; attempt: number };

/** Alle tatsächlich aktiven Funktionen (Schalter aus der Datenbank, Abhängigkeiten aufgelöst) – ohne Sitzung und ohne Anfrage-Zwischenspeicher. */
export async function activeFeatureSet(db: Pick<PrismaClient, "featureSetting"> = appDb): Promise<ReadonlySet<string>> {
  const rows = await db.featureSetting.findMany();
  return effectiveFeatureIds(MODULES, FEATURES, Object.fromEntries(rows.map((r) => [r.key, r.enabled])));
}

const processZone = () => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const MESSAGE_MAX = 300;
const LOCK_GRACE_MS = 60_000;

export function createJobRunner(options: RunnerOptions) {
  const db = options.db ?? appDb;
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? processZone;
  const processId = randomBytes(6).toString("hex");
  const inFlight = new Set<string>();
  let timers: { start?: NodeJS.Timeout; tick?: NodeJS.Timeout } = {};

  const activeFeatures = options.activeFeatures ?? (() => activeFeatureSet(db));

  const definitions = () => {
    const seen = new Set<string>();
    return options.jobs().filter((job) => {
      if (seen.has(job.id)) {
        console.error(`[jobs] Job-ID doppelt: ${stripControl(job.id, 60)}`);
        return false;
      }
      seen.add(job.id);
      try {
        validateSchedule(job.schedule);
      } catch (error) {
        console.error(`[jobs] Zeitplan von ${stripControl(job.id, 60)} ungültig: ${describeError(error)}`);
        return false;
      }
      return true;
    });
  };

  /** Legt den Zustand neuer Jobs an. Intervall-Jobs sind sofort fällig (erster Takt), Cron-Jobs zum nächsten Termin. */
  async function sync(): Promise<void> {
    const at = now();
    for (const job of definitions()) {
      if (await db.jobState.findUnique({ where: { id: job.id }, select: { id: true } })) continue;
      await db.jobState.create({ data: { id: job.id, nextRunAt: "every" in job.schedule ? at : nextRun(job.schedule, at, timeZone()) } });
    }
  }

  /** Beim Start aufrufen (vor dem ersten Takt): unterbrochene Läufe abschließen, Sperren lösen, Jobs wieder fällig stellen. */
  async function recover(): Promise<number> {
    const at = now();
    await db.jobRun.updateMany({ where: { status: "running" }, data: { status: "interrupted", finishedAt: at, message: "Neustart während des Laufs" } });
    const { count } = await db.jobState.updateMany({
      where: { lockedUntil: { not: null } },
      data: { lockedUntil: null, lockOwner: null, lastStatus: "interrupted", lastMessage: "Neustart während des Laufs", nextRunAt: at },
    });
    return count;
  }

  async function execute(job: JobDef, force: boolean): Promise<RunResult | null> {
    if (inFlight.has(job.id)) return null;
    const started = now();
    const timeoutMs = job.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
    // Sperre: nur wer das bedingte Update gewinnt, führt den Job aus
    const claim = await db.jobState.updateMany({
      where: {
        id: job.id,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: started } }],
        ...(force ? {} : { nextRunAt: { lte: started } }),
      },
      data: { lockedUntil: new Date(started.getTime() + timeoutMs + LOCK_GRACE_MS), lockOwner: processId },
    });
    if (claim.count !== 1) return null;
    inFlight.add(job.id);

    let state;
    let run;
    try {
      state = await db.jobState.findUniqueOrThrow({ where: { id: job.id } });
      run = await db.jobRun.create({ data: { jobId: job.id, startedAt: started, status: "running", attempt: state.failures + 1 } });
    } catch (error) {
      inFlight.delete(job.id); // die Sperre in der Datenbank verfällt von selbst
      throw error;
    }
    const attempt = state.failures + 1;

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const work = Promise.resolve().then(() => job.run({ now: started, signal: controller.signal, attempt }));
    // Bis die Funktion wirklich zurückkehrt, bleibt der Job für diesen Prozess belegt (auch nach einer Zeitüberschreitung)
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    void settled.then(() => inFlight.delete(job.id));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Zeitüberschreitung"));
      }, timeoutMs);
      timer.unref();
    });

    let status: "ok" | "error" = "ok";
    let message = "";
    try {
      const result = await Promise.race([work, timeout]);
      message = result ? stripControl(String(result), MESSAGE_MAX) : "";
    } catch (error) {
      status = "error";
      message = error instanceof Error && error.message === "Zeitüberschreitung" ? "Zeitüberschreitung" : describeError(error);
      logError(`job:${job.id}`, error);
    } finally {
      clearTimeout(timer);
    }

    const finished = now();
    const failures = status === "ok" ? 0 : state.failures + 1;
    const retry = job.retry ?? DEFAULT_JOB_RETRY;
    const next = status === "ok" ? nextRun(job.schedule, finished, timeZone()) : new Date(finished.getTime() + backoffDelay(failures, retry.baseDelayMs, retry.maxDelayMs));
    const durationMs = Math.max(0, finished.getTime() - started.getTime());
    try {
      await db.jobRun.update({ where: { id: run.id }, data: { status, finishedAt: finished, durationMs, message: message || null } });
      await db.jobState.update({
        where: { id: job.id },
        data: { lockedUntil: null, lockOwner: null, lastRunAt: started, lastStatus: status, lastMessage: message || null, failures, nextRunAt: next },
      });
    } catch (error) {
      // Die Sperre verfällt von selbst (lockedUntil); der nächste Takt versucht es wieder
      logError(`job:${job.id}:state`, error);
    }
    return { jobId: job.id, status, message, durationMs, attempt };
  }

  /**
   * Berechnet die nächsten Termine der Cron-Jobs neu (nach einem Wechsel der Zeitzone der Werkstatt): Ein Job, der „um 03:00“ läuft, soll um 03:00 Ortszeit der neuen
   * Zone laufen, nicht erst nach dem alten Termin. Jobs in einer Fehlerserie (Wiederholung mit Wartezeit), laufende und überfällige bleiben unberührt.
   */
  async function reschedule(): Promise<void> {
    const at = now();
    for (const job of definitions()) {
      if ("every" in job.schedule) continue;
      await db.jobState.updateMany({ where: { id: job.id, failures: 0, lockedUntil: null, nextRunAt: { gt: at } }, data: { nextRunAt: nextRun(job.schedule, at, timeZone()) } });
    }
  }

  /** Führt alle fälligen Jobs aus (gleichzeitig, jeder höchstens einmal). */
  async function tick(): Promise<RunResult[]> {
    const at = now();
    const [active, due] = await Promise.all([activeFeatures(), db.jobState.findMany({ where: { nextRunAt: { lte: at } }, select: { id: true } })]);
    const dueIds = new Set(due.map((d) => d.id));
    const runs = definitions()
      .filter((job) => dueIds.has(job.id) && (!job.feature || active.has(job.feature)))
      .map((job) => execute(job, false).catch((error) => (logError(`job:${job.id}`, error), null)));
    return (await Promise.all(runs)).filter((r): r is RunResult => r !== null);
  }

  /** Führt einen Job jetzt aus, unabhängig vom Zeitplan (Statusansicht „Jetzt ausführen“, Tests). Liefert null, wenn er gerade läuft oder unbekannt ist. */
  async function runNow(jobId: string): Promise<RunResult | null> {
    const job = definitions().find((j) => j.id === jobId);
    if (!job) return null;
    await sync();
    if (job.feature && !(await activeFeatures()).has(job.feature)) return null;
    return execute(job, true);
  }

  /** Startet den Zeitgeber (Takte laufen im Hintergrund und halten den Prozess nicht am Leben). */
  function start(): void {
    if (timers.start || timers.tick) return;
    const run = () => void tick().catch((error) => logError("jobs:tick", error));
    void recover()
      .then(() => sync())
      .then(() => {
        timers.start = setTimeout(() => {
          run();
          timers.tick = setInterval(run, options.tickMs ?? 15_000);
          timers.tick.unref();
        }, options.startDelayMs ?? 60_000);
        timers.start.unref();
      })
      .catch((error) => logError("jobs:start", error));
  }

  function stop(): void {
    clearTimeout(timers.start);
    clearInterval(timers.tick);
    timers = {};
  }

  return { sync, recover, tick, runNow, reschedule, start, stop, isRunning: (jobId: string) => inFlight.has(jobId) };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
