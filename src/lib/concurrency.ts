/**
 * Optimistische Sperre gegen verlorene Änderungen: Öffnen zwei Personen denselben Datensatz zum Bearbeiten, würde die zweite
 * Speicherung die erste still überschreiben. Deshalb trägt jedes Bearbeiten-Formular die Version der Zeile mit (den
 * Zeitpunkt der letzten Änderung, `updatedAt`). Beim Speichern wird die Zeile nur „belegt“, wenn sich die Version seit dem
 * Öffnen nicht geändert hat – sonst meldet die Aktion einen Konflikt und überschreibt nichts.
 */

/** Version einer Zeile als Formularwert (Millisekunden seit 1970 der letzten Änderung). */
export const versionOf = (row: { updatedAt: Date }): string => String(row.updatedAt.getTime());

/** Liest den Formularwert zurück; null bei fehlendem oder ungültigem Wert. */
export function versionDate(token: string | undefined | null): Date | null {
  if (!token || !/^\d{1,16}$/.test(token)) return null;
  const date = new Date(Number(token));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Belegt die Zeile für die Bearbeitung: `run` führt ein `updateMany` mit `where: { id, updatedAt: stamp }` und
 * `data: { updatedAt: next }` aus (`next` ist garantiert verschieden von `stamp`, auch bei Änderungen in derselben Millisekunde). Liefert false (Konflikt), wenn die Version fehlt oder die Zeile inzwischen geändert
 * oder gelöscht wurde. Atomar: von zwei gleichzeitigen Speicherungen gewinnt genau eine.
 */
export async function claimed(version: string | undefined | null, run: (stamp: Date, next: Date) => Promise<{ count: number }>): Promise<boolean> {
  const stamp = versionDate(version);
  return stamp !== null && (await run(stamp, new Date(Math.max(Date.now(), stamp.getTime() + 1)))).count > 0;
}

/** Was `claimRow` von einem Prisma-Modell braucht (`tx.user`, `tx.invoice` …): nur `updateMany`. */
type ClaimableModel = {
  updateMany(args: { where: { id: string; updatedAt: Date }; data: { updatedAt: Date } }): PromiseLike<{ count: number }>;
};

/**
 * Belegt eine Zeile für die Bearbeitung (siehe `claimed`) – kurz für `claimed(version, (stamp, next) => model.updateMany(...))`.
 * Immer mit dem Modell der **Transaktion** aufrufen (`claimRow(tx.invoice, id, version)`), damit Belegen und Schreiben zusammengehören.
 * Liefert false bei Konflikt (fehlende/veraltete Version oder Zeile weg).
 */
export function claimRow(model: ClaimableModel, id: string, version: string | undefined | null): Promise<boolean> {
  return claimed(version, async (stamp, next) => model.updateMany({ where: { id, updatedAt: stamp }, data: { updatedAt: next } }));
}
