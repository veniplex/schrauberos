/**
 * Fenster-Zähler für die API (reine Logik, mit hineingereichter Uhr, getestet): höchstens `limit` Treffer je Schlüssel und Zeitfenster.
 * Festes Fenster – einfach, schnell, ohne Speicher je Anfrage. Der Speicher ist begrenzt (`maxKeys`): zuerst fallen abgelaufene Fenster,
 * dann die ältesten.
 */
export type WindowResult = { allowed: boolean; limit: number; remaining: number; /** Sekunden bis zum Ende des Fensters (mindestens 1) */ resetSeconds: number };

export class WindowLimiter {
  private readonly entries = new Map<string, { start: number; count: number }>();

  constructor(private readonly options: { windowMs: number; maxKeys: number; now: () => number }) {}

  /** Zählt einen Treffer mit (auch den abgewiesenen nicht über das Limit hinaus) und sagt, ob er noch erlaubt ist. */
  hit(key: string, limit: number): WindowResult {
    const now = this.options.now();
    let entry = this.entries.get(key);
    if (!entry || now - entry.start >= this.options.windowMs) {
      this.makeRoom(now);
      entry = { start: now, count: 0 };
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    const allowed = entry.count < limit;
    if (allowed) entry.count += 1;
    return { allowed, limit, remaining: Math.max(0, limit - entry.count), resetSeconds: Math.max(1, Math.ceil((entry.start + this.options.windowMs - now) / 1000)) };
  }

  /** Schaut nur nach (zählt nicht): Ist der Schlüssel im laufenden Fenster schon über dem Limit? */
  exceeded(key: string, limit: number): WindowResult {
    const now = this.options.now();
    const entry = this.entries.get(key);
    const live = entry && now - entry.start < this.options.windowMs ? entry : undefined;
    const count = live?.count ?? 0;
    const resetSeconds = live ? Math.max(1, Math.ceil((live.start + this.options.windowMs - now) / 1000)) : 1;
    return { allowed: count < limit, limit, remaining: Math.max(0, limit - count), resetSeconds };
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private makeRoom(now: number): void {
    if (this.entries.size < this.options.maxKeys) return;
    for (const [key, entry] of this.entries) if (now - entry.start >= this.options.windowMs) this.entries.delete(key);
    // Immer noch voll (lauter laufende Fenster): die ältesten Einträge verdrängen
    let drop = this.entries.size - this.options.maxKeys + 1;
    for (const key of this.entries.keys()) {
      if (drop-- <= 0) break;
      this.entries.delete(key);
    }
  }
}
