/**
 * Reine Logik zum Neuschreiben der Baseline-Listen (`E2E_UPDATE_BASELINE=1`), getestet in `src/e2e-baseline.test.ts`.
 *
 * Die Regel „Listen bekannter Verstöße und JS-Budgets dürfen nur schrumpfen“ gilt damit nicht nur als Konvention, sondern wird beim Neuschreiben
 * erzwungen: Wächst etwas, bricht das Neuschreiben ab – außer es steht eine Begründung in `E2E_ALLOW_BASELINE_GROWTH` (mindestens 10 Zeichen; sie wird
 * ausgegeben und in `e2e/baselines/growth.log` festgehalten, fällt also im Review auf). Teilläufe (`--grep`, einzelne Projekte) löschen keine
 * Einträge von Seiten, die sie gar nicht geprüft haben.
 */
export type Baseline = Record<string, Record<string, Record<string, string[]>>>;
export type FoundEntry = { project: string; rule: string; pageKey: string; found: string[] };

export type MergeResult<T> = { next: T; growth: string[] };

/** Schreibt die in diesem Lauf geprüften Seiten neu in die bisherige Liste; nicht geprüfte Seiten bleiben unverändert. */
export function mergeBaseline(old: Baseline, found: readonly FoundEntry[]): MergeResult<Baseline> {
  const next: Baseline = JSON.parse(JSON.stringify(old)) as Baseline;
  const growth: string[] = [];
  for (const { project, rule, pageKey, found: list } of found) {
    const known = old[project]?.[rule]?.[pageKey] ?? [];
    const added = list.filter((f) => !known.includes(f));
    if (added.length) growth.push(`${project} / ${rule} / ${pageKey}: neu ${added.join(", ")}`);
    if (list.length) ((next[project] ??= {})[rule] ??= {})[pageKey] = [...list].sort();
    else if (next[project]?.[rule]) {
      delete next[project][rule][pageKey];
      if (!Object.keys(next[project][rule]).length) delete next[project][rule];
      if (!Object.keys(next[project]).length) delete next[project];
    }
  }
  return { next, growth };
}

/** Budget einer Route: Messung + 10 %, auf 5 KB aufgerundet. */
export const budgetFor = (kb: number) => Math.ceil((kb * 11) / 50) * 5;

/**
 * Neue JS-Budgets aus Messungen. Ein Budget darf sinken, aber nicht steigen (für bestehende Routen); neue Routen bekommen ihr Budget ohne Begründung.
 * Gemessene Routen, die nicht im Lauf waren, behalten ihr Budget.
 */
export function mergeBudget(old: Record<string, number>, measured: Readonly<Record<string, number>>): MergeResult<Record<string, number>> {
  const next = { ...old };
  const growth: string[] = [];
  for (const [route, kb] of Object.entries(measured)) {
    const limit = budgetFor(kb);
    if (route in old && limit > old[route]) growth.push(`JS-Budget ${route}: ${old[route]} KB -> ${limit} KB`);
    next[route] = limit;
  }
  return { next, growth };
}

const MIN_REASON = 10;

/** Prüft, ob Wachstum erlaubt ist: ohne Wachstum immer, sonst nur mit Begründung. Wirft sonst mit allen Einträgen in der Meldung. */
export function assertGrowthAllowed(growth: readonly string[], reason: string | undefined): void {
  if (!growth.length) return;
  if (reason && reason.trim().length >= MIN_REASON) return;
  throw new Error(
    `Die Baseline würde wachsen (${growth.length}):\n  ${growth.join("\n  ")}\n` +
      "Listen und Budgets dürfen nur schrumpfen. Ist das Wachstum bewusst, E2E_ALLOW_BASELINE_GROWTH=\"<Begründung>\" setzen (mindestens 10 Zeichen); sie landet in e2e/baselines/growth.log.",
  );
}
