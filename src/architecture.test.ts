import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FEATURES } from "@/modules/catalog";
import { featureKey } from "@/modules/catalog-logic";

/**
 * Architekturregeln (siehe README.md, Abschnitt Architektur):
 *  1. Die Plattform (server, components, i18n, lib, platform, capabilities) kennt keine einzelne Funktion.
 *  2. Funktionen sprechen nur über `public.ts` miteinander – und nur, wenn die Abhängigkeit in feature.ts deklariert ist.
 *  3. Seiten unter src/app gehören zu der Funktion, deren Route sie sind; für andere Funktionen gilt dasselbe wie in 2.
 */

const SRC = path.resolve(process.cwd(), "src");
/** Kompositionswurzeln: dürfen die Beschreibungen und Beiträge aller Funktionen einsammeln. */
const COMPOSITION_ROOTS = new Set(["modules/catalog.ts", "modules/registry.ts", "modules/help.ts", "modules/pages.ts"]);
/** Dateien im Modul-Wurzelordner, die Plattform-Code importieren darf (Katalog, Aktivierung, Registry …). */
const MODULE_ROOT_FILES = new Set(["catalog", "catalog-logic", "define", "features", "help", "pages", "registry", "types", "default-roles"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

type Import = { spec: string; line: number };

function importsOf(file: string): Import[] {
  const result: Import[] = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, i) => {
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) result.push({ spec: m[1], line: i + 1 });
    });
  return result;
}

/** Auflösen auf einen Pfad relativ zu src (ohne Endung), z. B. "modules/workshop/tires/public". */
function resolve(file: string, spec: string): string | null {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (spec.startsWith(".")) return path.relative(SRC, path.resolve(path.dirname(file), spec)).split(path.sep).join("/");
  return null;
}

/** "modules/workshop/tires/queries" → { module: "workshop", feature: "tires", rest: "queries" } */
function featureTarget(resolved: string) {
  const m = /^modules\/([a-z]+)\/([a-z]+)(?:\/(.+))?$/.exec(resolved);
  if (!m || MODULE_ROOT_FILES.has(m[1])) return null;
  // modules/<datei> (z. B. modules/catalog) sind keine Funktionen; module.ts liegt direkt im Modulordner
  if (!m[3] && !FEATURES.some((f) => f.module === m[1] && f.id === m[2])) return null;
  return { id: `${m[1]}.${m[2]}`, rest: m[3] ?? "" };
}

const featureById = new Map(FEATURES.map((f) => [featureKey(f), f]));

/** Wem gehört eine Datei? Funktionsordner unter modules, Seiten über ihre Route. */
function ownerOf(rel: string): string | null {
  const m = /^modules\/([a-z]+)\/([a-z]+)\//.exec(rel);
  if (m && featureById.has(`${m[1]}.${m[2]}`)) return `${m[1]}.${m[2]}`;
  if (rel.startsWith("app/")) {
    const url = rel
      .replace(/^app\//, "")
      .split("/")
      .filter((seg) => !/^\(.+\)$/.test(seg))
      .join("/");
    let best: { id: string; len: number } | null = null;
    for (const f of FEATURES) {
      for (const route of f.routes) {
        if ((url === route || url.startsWith(`${route}/`)) && (!best || route.length > best.len)) best = { id: featureKey(f), len: route.length };
      }
    }
    return best?.id ?? null;
  }
  return null;
}

const files = walk(SRC);

describe("Architektur", () => {
  it("Plattform-Code importiert keine einzelne Funktion", () => {
    const platform = /^(server|components|i18n|lib|platform|capabilities)\//;
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (!platform.test(rel)) continue;
      for (const imp of importsOf(file)) {
        const target = featureTarget(resolve(file, imp.spec) ?? "");
        if (target) violations.push(`${rel}:${imp.line} importiert ${imp.spec}`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("Funktionen und Seiten greifen auf andere Funktionen nur über public.ts zu", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const owner = ownerOf(rel);
      if (COMPOSITION_ROOTS.has(rel) || (!rel.startsWith("modules/") && !rel.startsWith("app/"))) continue;
      for (const imp of importsOf(file)) {
        const target = featureTarget(resolve(file, imp.spec) ?? "");
        if (!target || target.id === owner) continue;
        if (target.rest !== "public") violations.push(`${rel}:${imp.line} importiert ${imp.spec} (nur ${target.id}/public erlaubt)`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("Zugriffe auf andere Funktionen sind in feature.ts als requires/uses deklariert", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const owner = ownerOf(rel);
      if (!owner || !rel.startsWith("modules/")) continue; // Seiten ohne eigene Funktion (Dashboard, Konto …) sind Komposition
      const def = featureById.get(owner)!;
      const declared = new Set<string>([...("requires" in def ? def.requires : []), ...("uses" in def ? def.uses : [])]);
      for (const imp of importsOf(file)) {
        const target = featureTarget(resolve(file, imp.spec) ?? "");
        if (!target || target.id === owner) continue;
        if (!declared.has(target.id)) violations.push(`${rel}:${imp.line} nutzt ${target.id}, aber ${owner} deklariert es nicht (requires/uses)`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("Funktionen importieren nicht aus Seiten oder anderen Funktionsordnern per relativem Pfad", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const owner = ownerOf(rel);
      if (!owner || !rel.startsWith("modules/")) continue;
      for (const imp of importsOf(file)) {
        if (!imp.spec.startsWith(".")) continue;
        const resolved = resolve(file, imp.spec) ?? "";
        if (resolved.startsWith("app/")) violations.push(`${rel}:${imp.line} importiert aus app/`);
        const target = featureTarget(resolved);
        if (target && target.id !== owner) violations.push(`${rel}:${imp.line} importiert ${imp.spec} relativ aus einer anderen Funktion`);
      }
    }
    assert.deepEqual(violations, []);
  });
});
