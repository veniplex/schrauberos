/**
 * Laufzeit-Prüfungen ohne feste Millisekunden (Z6-4 M-3): Eine Wanduhr-Grenze wie „unter 2500 ms“ hängt an der Last des Rechners (der Sammellauf mit Coverage braucht das Fünfzehnfache) und wird zum Wackler.
 * Was ein Test beweisen will, ist die **Größenordnung** – „der Parser ist linear“ –, und die zeigt das Verhältnis: Dieselbe Aufgabe in vierfacher Größe braucht bei linearem Verhalten etwa die vierfache,
 * bei quadratischem die sechzehnfache Zeit. Beide Messungen laufen im selben Prozess unter derselben Last; gemessen wird je dreimal und die kürzeste Zeit genommen (Ausreißer nach oben fallen weg).
 */
export type LinearityResult = { smallMs: number; largeMs: number; ratio: number };

function bestOf<T>(runs: number, input: T, run: (input: T) => unknown): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    run(input);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * Misst `run` für die Größe `unit` und `4 × unit` und liefert das Verhältnis. Das Verhältnis ist nur aussagekräftig, wenn die kleine Messung nicht im Rauschen liegt: Liegt sie unter `floorMs`,
 * gilt sie als `floorMs` (eine sehr schnelle Aufgabe kann dann nie als „nicht linear“ auffallen – sie ist eben schnell).
 */
export function measureLinearity<T>(build: (size: number) => T, run: (input: T) => unknown, unit: number, options: { runs?: number; floorMs?: number } = {}): LinearityResult {
  const runs = options.runs ?? 3;
  const floor = options.floorMs ?? 5;
  const small = build(unit);
  const large = build(unit * 4);
  run(small); // aufwärmen
  const smallMs = Math.max(floor, bestOf(runs, small, run));
  const largeMs = bestOf(runs, large, run);
  return { smallMs, largeMs, ratio: largeMs / smallMs };
}

/** Vierfache Größe darf höchstens `maxRatio` mal so lange dauern (linear ≈ 4, quadratisch ≈ 16; Standard 9,5). */
export const LINEAR_MAX_RATIO = 9.5;
