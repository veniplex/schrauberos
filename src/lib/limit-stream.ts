import { Transform } from "node:stream";

export class StreamLimitError extends Error {
  constructor(readonly code: "tooLarge" | "diskFull") {
    super(code);
  }
}

export type LimitStreamOptions = {
  /** Obergrenze der durchgereichten Bytes (danach bricht der Strom mit `tooLarge` ab) */
  maxBytes: number;
  /** Freier Platz des Zieldatenträgers (null = unbekannt); mit `reserve` und `checkEvery` wird er laufend geprüft → `diskFull` */
  free?: () => Promise<number | null>;
  /** Soviel soll mindestens frei bleiben */
  reserve?: number;
  /** Alle so viele Bytes den freien Platz erneut prüfen (Standard 64 MiB) */
  checkEvery?: number;
};

/**
 * Zählender Durchlauf-Strom: bricht ab, sobald mehr als `maxBytes` hindurchgehen (Schutz vor Gzip-Bomben – ein winziges Archiv, das sich auf Terabyte entpackt),
 * und prüft optional laufend den freien Platz. Wird zwischen Entkomprimierer und Schreibstrom gesetzt.
 */
export function limitStream(options: LimitStreamOptions): Transform {
  const checkEvery = options.checkEvery ?? 64 * 1024 * 1024;
  let total = 0;
  let sinceCheck = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      sinceCheck += chunk.length;
      if (total > options.maxBytes) return callback(new StreamLimitError("tooLarge"));
      if (options.free && sinceCheck >= checkEvery) {
        sinceCheck = 0;
        options
          .free()
          .then((free) => (free !== null && free - chunk.length < (options.reserve ?? 0) ? callback(new StreamLimitError("diskFull")) : callback(null, chunk)))
          .catch(() => callback(null, chunk));
        return;
      }
      callback(null, chunk);
    },
  });
}
