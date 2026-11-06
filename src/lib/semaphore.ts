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
