/**
 * Wartet höchstens `ms` auf `promise`: danach gilt `fallback` (die Aufgabe selbst läuft weiter – SQLite-Abfragen lassen sich nicht abbrechen –, ihr Ergebnis wird verworfen).
 * Ein später eintretender Fehler der Aufgabe wird verschluckt (kein „unhandled rejection“); ein Fehler **vor** Ablauf wird weitergereicht. Der Zeitgeber wird immer abgeräumt.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
