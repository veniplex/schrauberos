import "server-only";
import { WindowLimiter } from "@/lib/api/limit";

/**
 * Zustand der Drosselung des Kalender-Abos im Prozess (Logik: `lib/api/limit.ts`; Muster wie `server/api/state.ts`). Gezählt werden **nur ungültige Aufrufe** (unbekanntes, abgelaufenes,
 * widerrufenes Token, Besitzer gesperrt): zuerst global, je Adresse nur hinter dem Reverse-Proxy (sonst wäre der Header fälschbar). Ein gültiges Token kommt nie hierher und wird von einer Flut
 * ungültiger Aufrufe nicht ausgebremst. Eigene Zähler (nicht die der API): Fehlversuche am Feed sollen Programmzugriffe nicht sperren und umgekehrt.
 */
export const feedRuntime = { now: (): number => Date.now() };

/** Grenzen der Fehlversuche je Minute (Tests ändern sie). */
export const feedLimits = { failuresGlobal: 120, failuresPerIp: 30 };

const now = () => feedRuntime.now();

function create() {
  return {
    failuresGlobal: new WindowLimiter({ windowMs: 60_000, maxKeys: 1, now }),
    failuresPerIp: new WindowLimiter({ windowMs: 60_000, maxKeys: 5_000, now }),
  };
}

const globalForFeed = globalThis as unknown as { __feedLimiters?: ReturnType<typeof create>; __feedCache?: FeedCache };
export const feedLimiters = (globalForFeed.__feedLimiters ??= create());

/**
 * **Erzeugung begrenzt je Token:** Ein gültiger Abruf baut die Datei höchstens einmal je `FEED_MIN_INTERVAL_MS` (30 s) je Token; Abrufe dazwischen bekommen die zuletzt gebaute Datei (oder 304, wenn der
 * Client sie schon hat). Das ist **keine Ablehnung** – Kalenderprogramme laden stündlich und zeigen bei einem Fehlerstatus Störungen –, sondern ein kleiner Zwischenspeicher im Prozess, damit ein
 * durchgesickertes oder zu eifriges Token den Server nicht mit Aufbauten auslastet (6 000 Termine ≈ 250 ms und 1,6 MiB je Aufbau). Rechte werden vor jeder Antwort geprüft (`authenticateFeed`); ändern sich Rechte,
 * Funktionen oder Sprache des Besitzers, gilt der Eintrag nicht mehr (`rightsKey`). Der Speicher ist begrenzt (Gesamtgröße, ältester Eintrag zuerst).
 */
export const FEED_MIN_INTERVAL_MS = 30_000;
export const FEED_CACHE_MAX_BYTES = 24 * 1024 * 1024;

export type CachedFeed = { builtAt: number; rightsKey: string; etag: string; truncated: boolean; body: string };

export class FeedCache {
  private readonly entries = new Map<string, CachedFeed>();
  private bytes = 0;
  constructor(private readonly maxBytes: number) {}

  get(key: string): CachedFeed | undefined {
    return this.entries.get(key);
  }
  set(key: string, entry: CachedFeed): void {
    this.delete(key);
    // ein einzelner Eintrag über der Hälfte des Speichers wird nicht gehalten (sonst verdrängt er alle anderen)
    if (entry.body.length * 2 > this.maxBytes / 2) return;
    this.entries.set(key, entry);
    this.bytes += entry.body.length * 2;
    // der älteste Eintrag zuerst (Einfügereihenfolge; ein neu gebauter Eintrag steht am Ende)
    for (const [oldest, value] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.bytes -= value.body.length * 2;
    }
  }
  delete(key: string): void {
    const old = this.entries.get(key);
    if (old) {
      this.entries.delete(key);
      this.bytes -= old.body.length * 2;
    }
  }
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
  get size(): number {
    return this.entries.size;
  }
}

export const feedCache: FeedCache = (globalForFeed.__feedCache ??= new FeedCache(FEED_CACHE_MAX_BYTES));
/** Gleichzeitige Aufbauten desselben Tokens teilen sich einen Lauf. */
export const feedInflight = new Map<string, Promise<CachedFeed>>();

/** Für Tests: alles auf Anfang. */
export function resetFeedLimiters(): void {
  feedLimits.failuresGlobal = 120;
  feedLimits.failuresPerIp = 30;
  Object.assign(feedLimiters, create());
  feedCache.clear();
  feedInflight.clear();
}
