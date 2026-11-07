/**
 * Zählende Sperre für aufwendige Arbeit (Passwort-Hashing). Höchstens `limit` Aufgaben laufen gleichzeitig, weitere warten in einer
 * Warteschlange; ist sie voll, wird mit `QueueFullError` abgewiesen – damit ein Schwung paralleler Anmeldungen weder den Speicher
 * füllt noch den Prozess minutenlang beschäftigt. Aufgaben ohne `bounded` (Passwort setzen durch angemeldete Benutzer) warten immer.
 */
export class QueueFullError extends Error {
  constructor() {
    super("Warteschlange voll");
  }
}

export class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    readonly limit: number,
    readonly maxQueue: number,
  ) {}

  get active(): number {
    return this.running;
  }
  get waiting(): number {
    return this.queue.length;
  }

  async run<T>(task: () => Promise<T>, options: { bounded?: boolean } = {}): Promise<T> {
    if (this.running >= this.limit) {
      if (options.bounded && this.queue.length >= this.maxQueue) throw new QueueFullError();
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else this.running += 1;
    // Der Platz wird beim Aufwecken direkt weitergereicht (running bleibt gleich), sonst könnte ein Neuankömmling dazwischenschlüpfen
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.running -= 1;
    }
  }
}

/**
 * Der **Eigentümer-Pfad** für aufwendige Arbeit, die nicht hinter einer Flut von Anmeldungen warten darf (Passwort setzen, Passwortabfrage im Konto, Anmeldung vom
 * bekannten Gerät, Notzugang). Anders als `Semaphore` ist er **gerecht und begrenzt**:
 *  - höchstens `limit` Aufgaben gleichzeitig, weitere warten;
 *  - **je Schlüssel** (Konto, Gerät, „setup“, „recovery“) höchstens `perKey` Aufgaben auf einmal – laufende und wartende zusammen. Wer mit demselben Konto
 *    eine Flut auslöst (gestohlenes Geräte-Cookie, wiederholte Passwortabfragen), belegt damit nur seine eigenen Plätze und blockiert nie die anderer Konten;
 *  - insgesamt höchstens `maxQueue` Wartende: darüber `QueueFullError` (die Aufrufer melden „bitte gleich noch einmal“ bzw. `busy`);
 *  - die Warteschlange wird **reihum** über die Schlüssel abgearbeitet (nicht in Ankunftsreihenfolge): ein Schlüssel mit vielen Wartenden verdrängt keinen anderen.
 */
export class FairLane {
  private running = 0;
  private waitingCount = 0;
  private readonly held = new Map<string, number>();
  private readonly queues = new Map<string, Array<() => void>>();
  /** Schlüssel mit Wartenden, in Reihumfolge */
  private readonly rotation: string[] = [];

  constructor(
    readonly limit: number,
    readonly maxQueue: number,
    readonly perKey: number,
  ) {}

  get active(): number {
    return this.running;
  }
  get waiting(): number {
    return this.waitingCount;
  }

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const held = this.held.get(key) ?? 0;
    if (held >= this.perKey) throw new QueueFullError();
    const mustWait = this.running >= this.limit;
    if (mustWait && this.waitingCount >= this.maxQueue) throw new QueueFullError();
    this.held.set(key, held + 1);
    try {
      if (mustWait) await this.enqueue(key);
      else this.running += 1;
      try {
        return await task();
      } finally {
        this.release();
      }
    } finally {
      const left = (this.held.get(key) ?? 1) - 1;
      if (left <= 0) this.held.delete(key);
      else this.held.set(key, left);
    }
  }

  private enqueue(key: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const queue = this.queues.get(key);
      if (queue) queue.push(resolve);
      else {
        this.queues.set(key, [resolve]);
        this.rotation.push(key);
      }
      this.waitingCount += 1;
    });
  }

  /** Platz freigeben: reihum dem nächsten Schlüssel direkt weiterreichen (`running` bleibt gleich), sonst frei werden lassen. */
  private release(): void {
    const key = this.rotation.shift();
    if (key === undefined) {
      this.running -= 1;
      return;
    }
    const queue = this.queues.get(key)!;
    const next = queue.shift()!;
    this.waitingCount -= 1;
    if (queue.length > 0) this.rotation.push(key);
    else this.queues.delete(key);
    next();
  }
}
