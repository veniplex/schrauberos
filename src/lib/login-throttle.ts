/**
 * Drosselung der Anmeldung – reine Logik ohne Datenbank und ohne Zeitgeber (die Uhr wird hineingereicht), vollständig getestet.
 *
 * Grundsätze:
 *  - **Keine harte Sperre.** Nach ein paar freien Versuchen wächst die Wartezeit je Versuch (2 s, 4 s, 8 s …) bis zu einer Obergrenze
 *    (Standard 90 s). Wer sich nur vertippt hat, wartet höchstens kurz; wer rät, kommt kaum voran.
 *  - **Gleich für bekannte und unbekannte Namen.** Der Speicher kennt nur Schlüssel, nicht, ob es das Konto gibt (kein Existenz-Orakel).
 *  - **Prüfen und Erhöhen sind synchron.** `check` und `take` enthalten kein `await`; ruft man sie hintereinander ohne dazwischen zu
 *    warten auf, kann ein Schwung paralleler Versuche die Drosselung nicht unterlaufen (JavaScript ist einfädig).
 *  - **Abgewiesene Versuche verlängern nichts.** Nur ein Versuch, der tatsächlich zur Passwortprüfung durchkommt, setzt die nächste
 *    Wartezeit. Sonst könnte jemand ein fremdes Konto mit Dauerbeschuss für immer sperren; so ist die Wartezeit höchstens die Obergrenze.
 *  - **Begrenzter Speicher.** Pro Gate höchstens `maxEntries` Schlüssel (mit lauter laufenden Wartezeiten höchstens das Doppelte); es fallen
 *    zuerst Einträge ohne Wartezeit, nie eine laufende Wartezeit zugunsten eines neuen Namens (siehe `makeRoom`).
 */

export type GateOptions = {
  /** Versuche ohne Wartezeit (danach beginnt die Verzögerung) */
  free: number;
  /** erste Wartezeit nach den freien Versuchen */
  baseMs: number;
  /** Obergrenze der Wartezeit */
  capMs: number;
  /** nach dieser Ruhezeit (seit dem letzten Versuch) beginnt die Zählung von vorn */
  decayMs: number;
  maxEntries: number;
  now: () => number;
};

type Entry = { attempts: number; until: number; lastAt: number };

export class Gate {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: GateOptions) {}

  /** Wartezeit nach dem n-ten Versuch (0 für die freien Versuche). */
  delayAfter(attempts: number): number {
    const { free, baseMs, capMs } = this.options;
    return attempts < free ? 0 : Math.min(capMs, baseMs * 2 ** Math.min(attempts - free, 20));
  }

  /** Verbleibende Wartezeit für diesen Schlüssel in ms; 0 = ein Versuch ist erlaubt. Ändert nichts. */
  check(key: string): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    const now = this.options.now();
    return entry.until > now ? entry.until - now : 0;
  }

  /** Belegt einen Versuch (pessimistisch, als wäre er falsch) und setzt die nächste Wartezeit. Vorher `check` aufrufen. */
  take(key: string): { attempts: number; delayMs: number } {
    const now = this.options.now();
    let entry = this.entries.get(key);
    if (entry && now - entry.lastAt > this.options.decayMs) entry = undefined; // lange Ruhe: von vorn
    if (!entry) {
      this.makeRoom();
      entry = { attempts: 0, until: 0, lastAt: now };
    }
    entry.attempts += 1;
    entry.lastAt = now;
    const delayMs = this.delayAfter(entry.attempts);
    entry.until = delayMs > 0 ? now + delayMs : 0;
    this.entries.delete(key); // ans Ende der Einfügereihenfolge (zuletzt benutzt)
    this.entries.set(key, entry);
    return { attempts: entry.attempts, delayMs };
  }

  /** Erfolgreiche Anmeldung: Zähler zurück auf null. */
  succeed(key: string): void {
    this.entries.delete(key);
  }

  /** Verzeiht `n` Versuche (z. B. ein Abbruch durch Überlast oder ein Erfolg bei einer Client-Adresse, die auch andere nutzen). */
  forgive(key: string, n = 1): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.attempts = Math.max(0, entry.attempts - n);
    if (entry.attempts < this.options.free) entry.until = 0;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  attemptsOf(key: string): number {
    return this.entries.get(key)?.attempts ?? 0;
  }

  /**
   * Platz schaffen. **Einträge mit laufender Wartezeit werden nie verdrängt**, solange es nicht anders geht – sonst könnte eine Flut
   * erfundener Namen eine Wartezeit (und damit auch die Antwort „gedrosselt“ für genau diesen Namen) löschen. Reihenfolge:
   *  1. Einträge ohne laufende Wartezeit, die ältesten zuerst (etwa 10 % der Grenze auf einmal);
   *  2. sind nur noch Einträge mit Wartezeit übrig, darf die Tabelle bis zum Doppelten der Grenze wachsen (jeder davon kostet einen
   *     Angreifer mehrere Anfragen innerhalb weniger Sekunden);
   *  3. darüber hinaus fällt der Eintrag, dessen Wartezeit am frühesten abläuft (er schützt am wenigsten).
   */
  private makeRoom(): void {
    const { maxEntries } = this.options;
    if (this.entries.size < maxEntries) return;
    const now = this.options.now();
    let drop = this.entries.size - maxEntries + Math.ceil(maxEntries / 10);
    for (const [key, entry] of this.entries) {
      if (drop <= 0) break;
      if (entry.until <= now) {
        this.entries.delete(key);
        drop--;
      }
    }
    if (this.entries.size < maxEntries * 2) return;
    let soonest: string | undefined;
    let soonestUntil = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.until < soonestUntil) {
        soonestUntil = entry.until;
        soonest = key;
      }
    }
    if (soonest !== undefined) this.entries.delete(soonest);
  }
}

/**
 * Globales Fehlversuchs-Budget: Häufen sich Fehlversuche über alle Konten hinweg (Passwort-Sprühangriff), werden Anmeldungen
 * zusätzlich **verlangsamt** – nie abgewiesen. So bleibt die Anmeldung für Berechtigte immer möglich, kostet aber mehr Zeit.
 */
export class FailureBudget {
  private stamps: number[] = [];

  constructor(
    private readonly options: { limit: number; windowMs: number; stepMs: number; maxDelayMs: number; maxStamps: number; now: () => number },
  ) {}

  record(): void {
    this.stamps.push(this.options.now());
    if (this.stamps.length > this.options.maxStamps) this.stamps.splice(0, this.stamps.length - this.options.maxStamps);
  }

  private recent(): number {
    const from = this.options.now() - this.options.windowMs;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i] < from) i++;
    if (i > 0) this.stamps.splice(0, i);
    return this.stamps.length;
  }

  /** Nimmt den zuletzt gezählten Versuch zurück (ein Versuch war doch erfolgreich). */
  release(): void {
    this.stamps.pop();
  }

  /** Zusätzliche Wartezeit in ms (0, solange das Budget nicht überschritten ist). */
  delayMs(): number {
    const over = this.recent() - this.options.limit;
    return over > 0 ? Math.min(this.options.maxDelayMs, over * this.options.stepMs) : 0;
  }
}

/** Höchstens `limit` Ereignisse je Schlüssel und Zeitraum (für das Audit-Log: Fehlversuche nicht jeden einzeln protokollieren). */
export class RateWindow {
  private readonly last = new Map<string, number>();
  private globalStamps: number[] = [];

  constructor(private readonly options: { perKeyMs: number; globalLimit: number; globalWindowMs: number; maxKeys: number; now: () => number }) {}

  /** Darf jetzt ein Eintrag geschrieben werden? Zählt bei „ja“ mit. */
  allow(key: string): boolean {
    const now = this.options.now();
    const previous = this.last.get(key);
    if (previous !== undefined && now - previous < this.options.perKeyMs) return false;
    const from = now - this.options.globalWindowMs;
    this.globalStamps = this.globalStamps.filter((s) => s >= from);
    if (this.globalStamps.length >= this.options.globalLimit) return false;
    this.globalStamps.push(now);
    this.last.delete(key);
    this.last.set(key, now);
    if (this.last.size > this.options.maxKeys) {
      let drop = this.last.size - this.options.maxKeys;
      for (const k of this.last.keys()) {
        if (drop-- <= 0) break;
        this.last.delete(k);
      }
    }
    return true;
  }
}
