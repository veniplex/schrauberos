import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_FILE, readBaseline } from "./support/baseline";
import { assertGrowthAllowed, mergeBaseline, mergeBudget, type Baseline, type FoundEntry } from "./support/baseline-merge";
import { BASELINE_DIR, FOUND_DIR, UPDATE_BASELINE } from "./support/env";

/**
 * Mit E2E_UPDATE_BASELINE=1: schreibt die gefundenen Verstöße und gemessenen JS-Budgets in die Baseline-Listen (sortiert, bei jedem Lauf gleiche
 * Reihenfolge). Nur geprüfte Seiten werden neu geschrieben; Wachstum bricht ab, außer E2E_ALLOW_BASELINE_GROWTH nennt eine Begründung
 * (Logik und Tests: e2e/support/baseline-merge.ts, src/e2e-baseline.test.ts).
 */
export default function globalTeardown() {
  if (UPDATE_BASELINE) {
    const found: FoundEntry[] = [];
    const measured: Record<string, number> = {};
    let files: string[] = [];
    try {
      files = readdirSync(FOUND_DIR);
    } catch {
      /* nichts gefunden */
    }
    for (const file of files) {
      const entry = JSON.parse(readFileSync(path.join(FOUND_DIR, file), "utf8")) as { route?: string; kb?: number } & Partial<FoundEntry>;
      if (file.startsWith("js__")) measured[entry.route!] = entry.kb!;
      else found.push(entry as FoundEntry);
    }

    const baseline = mergeBaseline(readBaseline(), found);
    const budgetFile = path.join(BASELINE_DIR, "js-budget.json");
    let oldBudget: Record<string, number> = {};
    try {
      oldBudget = JSON.parse(readFileSync(budgetFile, "utf8")) as Record<string, number>;
    } catch {
      /* erste Messung */
    }
    const budget = mergeBudget(oldBudget, measured);
    const growth = [...baseline.growth, ...budget.growth];
    const reason = process.env.E2E_ALLOW_BASELINE_GROWTH;
    try {
      assertGrowthAllowed(growth, reason);
    } catch (error) {
      rmSync(FOUND_DIR, { recursive: true, force: true });
      throw error;
    }

    const sortKeys = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    const out: Baseline = sortKeys(Object.fromEntries(Object.entries(baseline.next).map(([project, rules]) => [project, sortKeys(Object.fromEntries(Object.entries(rules).map(([rule, pages]) => [rule, sortKeys(pages)])))])));
    mkdirSync(BASELINE_DIR, { recursive: true });
    if (found.length) {
      writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 2) + "\n");
      console.log(`[e2e] Baseline geschrieben: ${path.relative(process.cwd(), BASELINE_FILE)}`);
    }
    if (Object.keys(measured).length) {
      writeFileSync(budgetFile, JSON.stringify(sortKeys(budget.next), null, 2) + "\n");
      console.log(`[e2e] JS-Budget geschrieben: ${path.relative(process.cwd(), budgetFile)}`);
    }
    if (growth.length) {
      const lines = growth.join("\n  ");
      appendFileSync(path.join(BASELINE_DIR, "growth.log"), `${new Date().toISOString()} ${reason!.trim()}\n  ${lines}\n`);
      console.warn(`[e2e] Baseline WÄCHST (begründet: ${reason!.trim()}):\n  ${lines}`);
    }
  }
  rmSync(FOUND_DIR, { recursive: true, force: true });
}
