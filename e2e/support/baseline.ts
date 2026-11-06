import { expect, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_DIR, FOUND_DIR, UPDATE_BASELINE } from "./env";

/**
 * Baseline-Listen bekannter Verstöße „je Regel und Seite“ (e2e/baselines/known-violations.json):
 *   { "<projekt>": { "<regel>": { "<seite>": ["<kennung>", …] } } }
 * Ein Lauf schlägt fehl, wenn ein Verstoß NEU ist (nicht in der Liste) – und ebenso, wenn die Liste Einträge enthält, die es nicht
 * mehr gibt (die Liste soll mit jedem Paket schrumpfen). `E2E_UPDATE_BASELINE=1` schreibt die Liste aus den gefundenen Werten neu.
 */
export type Baseline = Record<string, Record<string, Record<string, string[]>>>;
export const BASELINE_FILE = path.join(BASELINE_DIR, "known-violations.json");

let cached: Baseline | null = null;
export function readBaseline(): Baseline {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
  } catch {
    cached = {};
  }
  return cached;
}

/** Hält einen Fund fest (für das Neuschreiben der Baseline im globalTeardown) und prüft ihn gegen die Liste. */
export function checkAgainstBaseline(info: TestInfo, rule: string, pageKey: string, found: string[]) {
  const project = info.project.name;
  mkdirSync(FOUND_DIR, { recursive: true });
  writeFileSync(path.join(FOUND_DIR, `${project}__${rule}__${Buffer.from(pageKey).toString("base64url")}.json`), JSON.stringify({ project, rule, pageKey, found }));
  if (UPDATE_BASELINE) return;
  const known = readBaseline()[project]?.[rule]?.[pageKey] ?? [];
  const added = found.filter((f) => !known.includes(f));
  const fixed = known.filter((k) => !found.includes(k));
  expect.soft(added, `${rule}: neue Verstöße auf ${pageKey} (${project})`).toEqual([]);
  expect.soft(fixed, `${rule}: erledigte Einträge auf ${pageKey} (${project}) – aus e2e/baselines/known-violations.json entfernen (E2E_UPDATE_BASELINE=1 npm run e2e)`).toEqual([]);
}
