import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Der Image-Build (`Dockerfile`, Stufe `builder`: `COPY . .`, dann `npm run build`) sieht nur, was `.dockerignore` durchlässt. `next build` prüft die
 * Typen aller .ts-Dateien im Kontext – eine Datei, die etwas außerhalb des Kontexts importiert (früher: `src/*.test.ts` → `e2e/support/…`),
 * bricht den Build, obwohl `npm run typecheck` lokal grün ist. Dieser Test ist die statische Vorwegnahme davon: jede Quelldatei im Kontext darf nur
 * Importe haben, deren Ziel ebenfalls im Kontext liegt. (Dateien, die ein Test zur Laufzeit liest, gehören nicht dazu – Tests laufen nicht im Image-Build.)
 */

const ROOT = process.cwd();
/** Im Build erzeugt (`prisma generate`), steht deshalb nicht im Kontext und darf trotzdem importiert werden. */
const GENERATED_IN_BUILD = ["src/generated/", ".next/"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".e2e-data", "test-results", "playwright-report"]);
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".css"];

type Rule = { negate: boolean; re: RegExp };

/** `.dockerignore` nach den Regeln von Docker: Muster der Reihe nach, das letzte zutreffende gewinnt; ein Muster gilt auch für alles unter einem Treffer. */
export function parseDockerignore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1).trim();
    line = path.posix.normalize(line.replace(/^\/+/, "")).replace(/\/$/, "");
    let source = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "*" && line[i + 1] === "*") {
        source += ".*";
        i++;
        if (line[i + 1] === "/") i++;
      } else if (c === "*") source += "[^/]*";
      else if (c === "?") source += "[^/]";
      else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    rules.push({ negate, re: new RegExp(`^${source}$`) });
  }
  return rules;
}

export function inContext(rules: Rule[], rel: string): boolean {
  const parts = rel.split("/");
  let excluded = false;
  for (const { negate, re } of rules) {
    let hit = false;
    for (let i = 1; i <= parts.length && !hit; i++) hit = re.test(parts.slice(0, i).join("/"));
    if (hit) excluded = !negate;
  }
  return !excluded;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

function importsOf(rel: string): { spec: string; line: number }[] {
  const result: { spec: string; line: number }[] = [];
  readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .forEach((text, i) => {
      if (/^\s*(\*|\/\/)/.test(text)) return; // Kommentarzeilen
      for (const m of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) result.push({ spec: m[1], line: i + 1 });
    });
  return result;
}

/** Wie TypeScript (bundler): Datei, Datei mit Endung, Endung getauscht (.js → .ts), Ordner mit index. */
function resolveTarget(fromRel: string, spec: string): string | null | "external" {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return "external";
  const candidates = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`)];
  const swapped = /\.m?js$/.test(base) ? [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), base.replace(/\.mjs$/, ".mts")] : [];
  for (const c of [...candidates, ...swapped]) {
    if (existsSync(path.join(ROOT, c)) && statSync(path.join(ROOT, c)).isFile()) return c;
  }
  return null;
}

describe(".dockerignore und Importe", () => {
  const rules = parseDockerignore(readFileSync(path.join(ROOT, ".dockerignore"), "utf8"));

  it("Musterlogik: Ordner, Verneinung, Platzhalter", () => {
    const r = parseDockerignore("e2e\n!e2e/support\n*.db\nsrc/generated\n.env.*\n!.env.example\n**/tmp\n");
    assert.equal(inContext(r, "e2e/tests/a.ts"), false);
    assert.equal(inContext(r, "e2e/support/a.ts"), true);
    assert.equal(inContext(r, "src/app/page.tsx"), true);
    assert.equal(inContext(r, "src/generated/prisma/index.ts"), false);
    assert.equal(inContext(r, "dev.db"), false);
    assert.equal(inContext(r, "data/x.db"), true); // ein Muster ohne "**/" gilt nur an der Wurzel
    assert.equal(inContext(r, ".env.local"), false);
    assert.equal(inContext(r, ".env.example"), true);
    assert.equal(inContext(r, "a/b/tmp/x"), false);
  });

  it("die frühere Fehlerklasse wird erkannt: Import aus einem ausgeschlossenen Ordner", () => {
    const r = parseDockerignore("e2e\n");
    assert.equal(inContext(r, "e2e/support/https-proxy.ts"), false);
    assert.equal(inContext(r, "src/server/csv/index.ts"), true);
  });

  it("jede Quelldatei im Image-Kontext importiert nur, was im Kontext liegt (sonst scheitert `npm run build` im Dockerfile)", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const rel of walk(ROOT)) {
      if (!inContext(rules, rel)) continue;
      for (const { spec, line } of importsOf(rel)) {
        const target = resolveTarget(rel, spec);
        if (target === "external") continue;
        checked++;
        if (target === null) {
          const resolved = spec.startsWith("@/") ? `src/${spec.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
          if (!GENERATED_IN_BUILD.some((g) => `${resolved}/`.startsWith(g))) problems.push(`${rel}:${line}: "${spec}" lässt sich nicht auflösen`);
          continue;
        }
        if (GENERATED_IN_BUILD.some((g) => target.startsWith(g))) continue;
        if (!inContext(rules, target)) problems.push(`${rel}:${line}: "${spec}" → ${target} liegt laut .dockerignore nicht im Image-Kontext`);
      }
    }
    assert.ok(checked > 500, `zu wenige Importe geprüft (${checked})`);
    assert.deepEqual(problems, [], `Importe außerhalb des Docker-Kontexts:\n${problems.join("\n")}`);
  });
});
