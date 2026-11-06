import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_FILE, readBaseline, type Baseline } from "./support/baseline";
import { BASELINE_DIR, FOUND_DIR, UPDATE_BASELINE } from "./support/env";

/** Mit E2E_UPDATE_BASELINE=1: schreibt die gefundenen Verstöße als neue Baseline-Liste (sortiert, bei jedem Lauf gleiche Reihenfolge). */
export default function globalTeardown() {
  if (UPDATE_BASELINE) {
    const ran = new Set<string>();
    const baseline: Baseline = {};
    let files: string[] = [];
    try {
      files = readdirSync(FOUND_DIR);
    } catch {
      /* nichts gefunden */
    }
    const budget: Record<string, number> = {};
    for (const file of files) {
      if (file.startsWith("js__")) {
        const { route, kb } = JSON.parse(readFileSync(path.join(FOUND_DIR, file), "utf8")) as { route: string; kb: number };
        budget[route] = Math.ceil((kb * 1.1) / 5) * 5; // Messung + 10 % Luft, auf 5 KB gerundet
        continue;
      }
      const { project, rule, pageKey, found } = JSON.parse(readFileSync(path.join(FOUND_DIR, file), "utf8")) as { project: string; rule: string; pageKey: string; found: string[] };
      ran.add(project);
      if (found.length) ((baseline[project] ??= {})[rule] ??= {})[pageKey] = found;
    }
    // Projekte, die in diesem Lauf nicht liefen, behalten ihre bisherige Liste (Aktualisieren immer mit vollständigem Lauf je Projekt)
    for (const [project, rules] of Object.entries(readBaseline())) if (!ran.has(project)) baseline[project] = rules;
    const sortKeys = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    const out: Baseline = sortKeys(Object.fromEntries(Object.entries(baseline).map(([project, rules]) => [project, sortKeys(Object.fromEntries(Object.entries(rules).map(([rule, pages]) => [rule, sortKeys(pages)])))])));
    mkdirSync(BASELINE_DIR, { recursive: true });
    if (ran.size) writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 2) + "\n");
    if (Object.keys(budget).length) {
      const file = path.join(BASELINE_DIR, "js-budget.json");
      let old: Record<string, number> = {};
      try {
        old = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
      } catch {
        /* erste Messung */
      }
      const merged = { ...old, ...budget };
      writeFileSync(file, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]])), null, 2) + "\n");
      console.log(`[e2e] JS-Budget geschrieben: ${path.relative(process.cwd(), file)}`);
    }
    if (ran.size) console.log(`[e2e] Baseline geschrieben: ${path.relative(process.cwd(), BASELINE_FILE)}`);
  }
  rmSync(FOUND_DIR, { recursive: true, force: true });
}
