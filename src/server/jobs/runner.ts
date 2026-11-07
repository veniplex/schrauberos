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
 *    einem zweiten Takt – scheitert daran. Zusätzlich merkt sich der Prozess laufende Jobs, bis die Funktion wirklich zurückkehrt (auch nach Zeitüberschreitung);
 *    reagiert ein Job nicht auf `ctx.signal` und hängt, bekommt er für jeden fälligen Termin einen sichtbaren Vermerk (`lastMessage`) und die Fehlerserie wächst.
 *    Scheitert das Belegen nach dem Update (Datenbankfehler), wird die Sperre sofort wieder freigegeben (best effort), sonst verfällt sie nach Ablauf.
 *  - **Nur Auffälliges wird festgehalten:** Ein Lauf ohne Fehler und ohne Ergebnismeldung hinterlässt keinen `JobRun` (sonst Zehntausende Zeilen am Tag für den
 *    15-Sekunden-Takt der Outbox); `JobState` (letzter Lauf, nächster Termin) wird immer aktualisiert. Jobs mit `shouldRun` werden vor dem Belegen billig befragt
 *    und schreiben nichts, wenn es nichts zu tun gibt.
 *  - **Neustart mitten im Lauf:** Es läuft nur ein Prozess (ein Container). `recover()` beim Start hält alle noch belegten Jobs als „unterbrochen“ fest (ein `JobRun`
 *    je Job), gibt die Sperren frei und setzt die Jobs auf „sofort“ – die Jobs sind wiederholbar. Läuft versehentlich ein zweiter Prozess, ist `recover()` nicht sicher.
 *  - **Start mit Wiederholung:** Der Zeitgeber wird immer gesetzt. `recover()`/`sync()` laufen sofort und – scheitern sie (Datenbank kurz weg) – bei jedem Takt erneut,
 *    bis es gelingt; kein Takt läuft vorher. `status()` meldet den letzten Takt („Runner zuletzt aktiv“ im Systemstatus).
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

/** Zustand des Zeitgebers (im Prozessspeicher; für den Systemstatus). */
export type RunnerStatus = {
  started: boolean;
  /** `recover()`/`sync()` sind gelungen */
  prepared: boolean;
  /** Beginn des letzten Takts (auch wenn er scheiterte) */
  lastTickAt: Date | null;
  /** Fehler des letzten Takts bzw. der Vorbereitung (kurz, ohne Nutzdaten); null, wenn alles lief */
  lastError: string | null;
};

/** Alle tatsächlich aktiven Funktionen (Schalter aus der Datenbank, Abhängigkeiten aufgelöst) – ohne Sitzung und ohne Anfrage-Zwischenspeicher. */
export async function activeFeatureSet(db: Pick<PrismaClient, "featureSetting"> = appDb): Promise<ReadonlySet<string>> {
  const rows = await db.featureSetting.findMany();
  return effectiveFeatureIds(MODULES, FEATURES, Object.fromEntries(rows.map((r) => [r.key, r.enabled])));
}

const processZone = () => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const MESSAGE_MAX = 300;
const LOCK_GRACE_MS = 60_000;

type Flight = { startedAt: number; timeoutMs: number };

export function createJobRunner(options: RunnerOptions) {
  const db = options.db ?? appDb;
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? processZone;
  const processId = randomBytes(6).toString("hex");
  /** Laufende Jobs dieses Prozesses (bis die Funktion wirklich zurückkehrt – auch nach Zeitüberschreitung) */
  const inFlight = new Map<string, Flight>();
  let timers: { start?: NodeJS.Timeout; tick?: NodeJS.Timeout } = {};
  const status: RunnerStatus = { started: false, prepared: false, lastTickAt: null, lastError: null };
  let preparing: Promise<void> | null = null;
  let beating = false;

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

  /** Beim Start aufrufen (vor dem ersten Takt): unterbrochene Läufe festhalten, Sperren lösen, Jobs wieder fällig stellen. */
  async function recover(): Promise<number> {
    const at = now();
    // Läufe, die ein früherer Stand als „läuft“ angelegt hat
    await db.jobRun.updateMany({ where: { status: "running" }, data: { status: "interrupted", finishedAt: at, message: "Neustart während des Laufs" } });
    const locked = await db.jobState.findMany({ where: { lockedUntil: { not: null } }, select: { id: true, lockedUntil: true } });
    if (locked.length === 0) return 0;
    await db.jobRun.createMany({ data: locked.map((s) => ({ jobId: s.id, startedAt: at, finishedAt: at, status: "interrupted", message: "Neustart während des Laufs" })) });
    const { count } = await db.jobState.updateMany({
      where: { lockedUntil: { not: null } },
      data: { lockedUntil: null, lockOwner: null, lastStatus: "interrupted", lastMessage: "Neustart während des Laufs", nextRunAt: at },
    });
    return count;
  }

  /**
   * Der Job hängt noch von einem früheren Lauf, der sein Zeitlimit überschritten hat (er ignoriert `ctx.signal`): Neue Läufe starten erst nach seinem Ende.
   * Damit das nicht unbemerkt bleibt, steht am Job ein Vermerk, die Fehlerserie wächst und der nächste Termin rückt nach der Wartezeit weiter.
   */
  async function noteStuck(job: JobDef, flight: Flight): Promise<void> {
    const at = now();
    if (at.getTime() - flight.startedAt <= flight.timeoutMs) return; // läuft noch innerhalb des Zeitlimits: normal, nichts zu melden
    const retry = job.retry ?? DEFAULT_JOB_RETRY;
    try {
      const state = await db.jobState.findUnique({ where: { id: job.id }, select: { failures: true } });
      const failures = (state?.failures ?? 0) + 1;
      await db.jobState.update({
        where: { id: job.id },
        data: {
          failures,
          lastStatus: "error",
          lastMessage: "Hängt: der Lauf reagiert nicht auf das Zeitlimit; ein neuer Lauf beginnt erst nach seinem Ende",
          nextRunAt: new Date(at.getTime() + backoffDelay(failures, retry.baseDelayMs, retry.maxDelayMs)),
        },
      });
    } catch (error) {
      logError(`job:${job.id}:stuck`, error);
    }
  }

  /** Gibt die Sperre des Jobs frei, wenn sie noch dieser Prozess hält (best effort: scheitert das, verfällt sie von selbst). */
  async function releaseLock(jobId: string): Promise<void> {
    await db.jobState.updateMany({ where: { id: jobId, lockOwner: processId }, data: { lockedUntil: null, lockOwner: null } }).catch(() => undefined);
  }

  async function execute(job: JobDef, force: boolean): Promise<RunResult | null> {
    const flight = inFlight.get(job.id);
    if (flight) {
      await noteStuck(job, flight);
      return null;
    }
    const started = now();
    // Vorabprüfung ohne Schreibzugriffe (nicht bei „Jetzt ausführen“)
    if (!force && job.shouldRun && !(await job.shouldRun({ now: started }))) return null;
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
    inFlight.set(job.id, { startedAt: started.getTime(), timeoutMs });

    let state;
    try {
      state = await db.jobState.findUniqueOrThrow({ where: { id: job.id } });
    } catch (error) {
      inFlight.delete(job.id);
      await releaseLock(job.id); // sonst bliebe der Job bis zum Ablauf der Sperre (Zeitlimit + 1 min) liegen
      throw error;
    }
    const attempt = state.failures + 1;

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const work = Promise.resolve().then(() => job.run({ now: started, signal: controller.signal, attempt, manual: force }));
    // Bis die Funktion wirklich zurückkehrt, bleibt der Job für diesen Prozess belegt (auch nach einer Zeitüberschreitung)
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    void settled.then(() => inFlight.delete(job.id));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("Zeitüberschreitung"));
      }, timeoutMs);
      timer.unref();
    });

    let outcome: "ok" | "error" = "ok";
    let message = "";
    try {
      const result = await Promise.race([work, timeout]);
      message = result ? stripControl(String(result), MESSAGE_MAX) : "";
    } catch (error) {
      outcome = "error";
      message = timedOut ? "Zeitüberschreitung" : describeError(error);
      logError(`job:${job.id}`, error);
    } finally {
      clearTimeout(timer);
    }

    const finished = now();
    const failures = outcome === "ok" ? 0 : state.failures + 1;
    const retry = job.retry ?? DEFAULT_JOB_RETRY;
    const next = outcome === "ok" ? nextRun(job.schedule, finished, timeZone()) : new Date(finished.getTime() + backoffDelay(failures, retry.baseDelayMs, retry.maxDelayMs));
    const durationMs = Math.max(0, finished.getTime() - started.getTime());
    try {
      // Nur Auffälliges (Fehler, Ergebnismeldung) wird als Lauf festgehalten – leere Erfolge sind der Normalfall und schreiben nur den Zustand
      if (outcome !== "ok" || message) {
        await db.jobRun.create({ data: { jobId: job.id, startedAt: started, finishedAt: finished, status: outcome, attempt, durationMs, message: message || null } });
      }
      await db.jobState.update({
        where: { id: job.id },
        data: { lockedUntil: null, lockOwner: null, lastRunAt: started, lastStatus: outcome, lastMessage: message || null, failures, nextRunAt: next },
      });
    } catch (error) {
      // Der Zustand ließ sich nicht schreiben: Sperre best effort lösen, sonst verfällt sie von selbst (lockedUntil); der nächste Takt versucht es wieder
      logError(`job:${job.id}:state`, error);
      await releaseLock(job.id);
    }
    if (outcome === "error" && job.onFailure) await job.onFailure({ attempt, timedOut }).catch((error) => logError(`job:${job.id}:onFailure`, error));
    return { jobId: job.id, status: outcome, message, durationMs, attempt };
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

  /**
   * Führt einen Job jetzt aus, unabhängig vom Zeitplan („Jetzt ausführen“ in der Verwaltung, Tests). Liefert null, wenn er gerade läuft, unbekannt oder die Funktion
   * ausgeschaltet ist. Zeit- und Tagesbedingungen des Jobs gelten nicht (`ctx.manual`).
   */
  async function runNow(jobId: string): Promise<RunResult | null> {
    const job = definitions().find((j) => j.id === jobId);
    if (!job) return null;
    await sync();
    if (job.feature && !(await activeFeatures()).has(job.feature)) return null;
    return execute(job, true);
  }

  /** `recover()` und `sync()` einmal erfolgreich (gleichzeitige Aufrufe teilen sich den Versuch; ein Fehlschlag wird beim nächsten Aufruf wiederholt). */
  function prepare(): Promise<void> {
    if (status.prepared) return Promise.resolve();
    preparing ??= (async () => {
      try {
        await recover();
        await sync();
        status.prepared = true;
        status.lastError = null;
      } catch (error) {
        status.lastError = `Vorbereitung: ${describeError(error)}`;
        throw error;
      } finally {
        preparing = null;
      }
    })();
    return preparing;
  }

  /** Ein Takt des Zeitgebers: vorbereiten (falls noch nicht gelungen), dann fällige Jobs. Überschneidet sich nie mit dem vorigen Takt. */
  async function beat(): Promise<void> {
    if (beating) return;
    beating = true;
    status.lastTickAt = now();
    try {
      await prepare();
      await tick();
      status.lastError = null;
    } catch (error) {
      status.lastError ??= describeError(error);
      throw error;
    } finally {
      beating = false;
    }
  }

  /**
   * Startet den Zeitgeber (Takte laufen im Hintergrund und halten den Prozess nicht am Leben). Die Timer werden **immer** gesetzt; ein Fehler bei
   * `recover()`/`sync()` (Datenbank kurz nicht erreichbar) beendet den Runner nicht, sondern wird beim nächsten Takt wiederholt.
   */
  function start(): void {
    if (status.started) return;
    status.started = true;
    const run = () => void beat().catch((error) => logError("jobs:tick", error));
    void prepare().catch((error) => logError("jobs:start", error));
    timers.start = setTimeout(() => {
      run();
      timers.tick = setInterval(run, options.tickMs ?? 15_000);
      timers.tick.unref();
    }, options.startDelayMs ?? 60_000);
    timers.start.unref();
  }

  function stop(): void {
    clearTimeout(timers.start);
    clearInterval(timers.tick);
    timers = {};
    status.started = false;
  }

  return {
    sync,
    recover,
    tick,
    beat,
    prepare,
    runNow,
    reschedule,
    start,
    stop,
    status: (): RunnerStatus => ({ ...status }),
    isRunning: (jobId: string) => inFlight.has(jobId),
  };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
