/**
 * Einfache Mengenbegrenzung („höchstens `max` Anfragen je `windowMs`“) im Arbeitsspeicher – reine Logik ohne Zeitgeber (die Uhr wird hineingereicht), getestet.
 * Gleitendes Fenster je Schlüssel (Benutzer): Jede erlaubte Anfrage wird mit ihrem Zeitpunkt vermerkt, alte fallen heraus. Der Speicher ist begrenzt
 * (`maxKeys`; bei Überlauf fallen zuerst Schlüssel ohne Anfragen im Fenster). Gedacht für billige, häufige Aufrufe (Schnellsuche), nicht für Anmeldeversuche (dafür `login-throttle`).
 * Prüfen und Vermerken sind synchron (kein `await`), ein Schwung paralleler Anfragen kann die Grenze nicht unterlaufen.
 */
export type RateLimiterOptions = { max: number; windowMs: number; maxKeys?: number; now?: () => number };

export type RateDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 5000;
    this.now = options.now ?? Date.now;
  }

  /** Eine Anfrage dieses Schlüssels: erlaubt (und vermerkt) oder abgewiesen mit der Wartezeit bis zum nächsten freien Platz. */
  take(key: string): RateDecision {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: Math.max(1, recent[0] + this.windowMs - now) };
    }
    recent.push(now);
    this.hits.delete(key); // ans Ende der Einfügereihenfolge: zuletzt benutzte Schlüssel fallen zuletzt heraus
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.evict(now);
    return { allowed: true };
  }

  private evict(now: number) {
    for (const [key, list] of this.hits) {
      if (this.hits.size <= this.maxKeys) return;
      if (list.every((at) => now - at >= this.windowMs)) this.hits.delete(key);
    }
    // alles noch im Fenster: die ältesten Schlüssel gehen (Einfügereihenfolge)
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) return;
      this.hits.delete(key);
    }
  }
}
