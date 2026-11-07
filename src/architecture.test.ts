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
const COMPOSITION_ROOTS = new Set(["modules/catalog.ts", "modules/registry.ts", "modules/help.ts", "modules/pages.ts", "modules/operation-hooks.ts", "modules/api.ts", "modules/jobs.ts", "modules/secrets.ts"]);
/** Dateien im Modul-Wurzelordner, die Plattform-Code importieren darf (Katalog, Aktivierung, Registry …). */
const MODULE_ROOT_FILES = new Set(["catalog", "catalog-logic", "define", "features", "help", "pages", "registry", "types", "default-roles", "operation-hooks", "api", "jobs", "secrets"]);

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

/** `defineOperation(...)` bzw. `defineOperation<...>(...)` (Aufruf, nicht Import/Definition) und der Rumpf bis `});` am Zeilenanfang. */
const OPERATION_CALL = /^(?:export\s+)?(?:const|let|var)\s+\w+(?:\s*:[^=]+)?\s*=\s*defineOperation\s*(?:<[^(]*>)?\s*\(/gm;
const OPERATION_BODY = /defineOperation\s*(?:<[^(]*>)?\s*\(\{([\s\S]*?)\n\}\)/g;

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

/**
 * Aktions-Rahmen (README, „Aktionen und Operationen“): Jede schreibende Server Action läuft über `defineAction(defineOperation(...))`.
 * Dateien mit `"use server"`, die noch eigene `export async function`s haben, stehen mit Begründung in dieser Liste. Sie darf nur
 * schrumpfen: Ein Eintrag, der nichts mehr verletzt, bricht den Test (dann bitte streichen).
 */
const LEGACY_ACTION_FILES: Record<string, string> = {
  "app/login/actions.ts": "Anmeldung/Abmeldung vor der Sitzung: eigener Drosselungspfad (Anmeldung), kein Recht prüfbar",
  "app/login/recover/actions.ts": "Notzugang vor der Sitzung: eigener Pfad ohne Konto-Drosselung",
  "app/login/verify/actions.ts": "Zweiter Schritt der Anmeldung vor der Sitzung: Zwischenzustand statt Recht, eigene Drosselung (loginThrottle.totp)",
  "app/setup/actions.ts": "Ersteinrichtung vor dem ersten Benutzer: Einrichtungs-Token statt Recht",
};

/** Verstöße einer Datei mit `"use server"`: alles, was exportiert wird, aber nicht mit `defineAction(` erzeugt ist, sowie Inline-Aktionen. */
function actionViolations(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) found.push(`export function ${m[1]}`);
  for (const m of source.matchAll(/^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=(?!\s*defineAction\()/gm)) found.push(`export ${m[1]} ohne defineAction`);
  if (/^export\s+default\b/m.test(source)) found.push("export default");
  for (const m of source.matchAll(/^export\s*\{[^}]*\}(?:\s*from)?/gm)) found.push(`Re-Export ${m[0].slice(0, 40)}`);
  // Inline-Aktionen in Komponenten: die Direktive steht in einem Funktionsrumpf (eingerückt)
  if (/^[ \t]+["']use server["']/m.test(source)) found.push("Inline-Aktion (use server im Funktionsrumpf)");
  return found;
}

describe("Job-Runner", () => {
  it("Jobs und Outbox-Abnehmer einer Funktion (jobs.ts) nennen nur diese Funktion als `feature` – sie laufen nur, solange sie aktiv ist", () => {
    const wrong: string[] = [];
    let found = 0;
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const m = /^modules\/([a-z]+)\/([a-z]+)\/jobs\.ts$/.exec(rel);
      if (!m) continue;
      found++;
      const source = readFileSync(file, "utf8");
      for (const f of source.matchAll(/\bfeature:\s*"([^"]+)"/g)) if (f[1] !== `${m[1]}.${m[2]}`) wrong.push(`${rel}: feature "${f[1]}" statt "${m[1]}.${m[2]}"`);
      if (!/\bfeature:\s*"/.test(source)) wrong.push(`${rel}: kein Job nennt eine Funktion`);
      // Jeder Job und jeder Abnehmer (id: "…") braucht sein feature: "…" – sonst liefe er auch bei ausgeschalteter Funktion (die Prüfung per Import steht in jobs.test.ts)
      const ids = [...source.matchAll(/^\s*id:\s*"/gm)].length;
      const features = [...source.matchAll(/^\s*feature:\s*"/gm)].length;
      if (ids !== features) wrong.push(`${rel}: ${ids} Einträge mit id, aber ${features} mit feature`);
    }
    assert.ok(found >= 2, "jobs.ts der Funktionen gefunden");
    assert.deepEqual(wrong, []);
  });

  it("jede jobs.ts einer Funktion ist in src/modules/jobs.ts eingetragen (sonst läuft sie nie)", () => {
    const root = readFileSync(path.join(SRC, "modules/jobs.ts"), "utf8");
    const missing: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const m = /^modules\/([a-z]+)\/([a-z]+)\/jobs\.ts$/.exec(rel);
      if (m && !root.includes(`./${m[1]}/${m[2]}/jobs`)) missing.push(rel);
    }
    assert.deepEqual(missing, []);
  });
});

describe("Geheimnis-Verbraucher", () => {
  it("jede secrets.ts einer Funktion ist in src/modules/secrets.ts eingetragen (sonst werden ihre Geheimnisse nach einem Restore ohne Schlüssel nie zurückgesetzt)", () => {
    const root = readFileSync(path.join(SRC, "modules/secrets.ts"), "utf8");
    const missing: string[] = [];
    let found = 0;
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const m = /^modules\/([a-z]+)\/([a-z]+)\/secrets\.ts$/.exec(rel);
      if (!m) continue;
      found++;
      if (!root.includes(`./${m[1]}/${m[2]}/secrets`)) missing.push(rel);
    }
    assert.ok(found >= 2, "secrets.ts der Funktionen gefunden");
    assert.deepEqual(missing, []);
  });

  it("jede Funktion, die setSecret benutzt, meldet einen Verbraucher an (secrets.ts) – sonst bliebe ihr Geheimnis nach einem Restore ohne Schlüssel unlesbar liegen", () => {
    const missing: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const m = /^modules\/([a-z]+)\/([a-z]+)\//.exec(rel);
      if (!m || /\/secrets\.ts$/.test(rel) || !/\bsetSecret\(|\bsaveOffsiteCredentials\(/.test(readFileSync(file, "utf8"))) continue;
      if (!files.some((f) => path.relative(SRC, f).split(path.sep).join("/") === `modules/${m[1]}/${m[2]}/secrets.ts`)) missing.push(rel);
    }
    assert.deepEqual(missing, []);
  });
});

describe("Aktions-Rahmen", () => {
  const hasDirective = (source: string) => /^[ \t]*["']use server["'];?[ \t]*$/m.test(source);
  const actionFiles = files.filter((file) => hasDirective(readFileSync(file, "utf8")));
  const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

  it("jede schreibende Server Action benutzt den Rahmen (defineAction)", () => {
    const violations: string[] = [];
    for (const file of actionFiles) {
      const name = rel(file);
      if (name in LEGACY_ACTION_FILES) continue;
      for (const v of actionViolations(readFileSync(file, "utf8"))) violations.push(`${name}: ${v}`);
    }
    assert.deepEqual(violations, []);
  });

  it("die Liste der Altlasten schrumpft nur: jeder Eintrag verletzt die Regel noch und die Datei existiert", () => {
    const stale: string[] = [];
    for (const [name, reason] of Object.entries(LEGACY_ACTION_FILES)) {
      const file = files.find((f) => rel(f) === name);
      if (!file) stale.push(`${name}: Datei existiert nicht mehr`);
      else if (actionViolations(readFileSync(file, "utf8")).length === 0) stale.push(`${name}: erfüllt die Regel schon – bitte aus LEGACY_ACTION_FILES streichen`);
      assert.ok(reason.length > 10, `${name}: Begründung fehlt`);
    }
    assert.deepEqual(stale, []);
  });

  it("umgestellte Aktionsdateien kennen weder redirect noch Flash noch Cookies: run bleibt transportneutral", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/\bdefineOperation\(/.test(source) || rel(file).startsWith("server/operations/")) continue;
      for (const imp of importsOf(file)) {
        if (/^next\/(navigation|cache|headers)$/.test(imp.spec) || /operations\/flash$/.test(imp.spec)) violations.push(`${rel(file)}:${imp.line} importiert ${imp.spec}`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("jede Operation nennt Recht, Eingabe und Audit (oder begründet den Verzicht)", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (rel(file).startsWith("server/operations/")) continue;
      for (const m of source.matchAll(OPERATION_BODY)) {
        const body = m[1];
        const name = /name:\s*"([^"]+)"/.exec(body)?.[1] ?? "?";
        // Recht als Zeichenkette oder als benannte Konstante (GROSSBUCHSTABEN, z. B. bei eingabeabhängigem Recht mit `permissionFor`)
        if (!/\bpermission:\s*(?:"|[A-Z][A-Z_]*\b)/.test(body)) violations.push(`${rel(file)}: ${name} ohne permission`);
        if (!/\binput:/.test(body)) violations.push(`${rel(file)}: ${name} ohne input`);
        if (!/\baudit:/.test(body)) violations.push(`${rel(file)}: ${name} ohne audit`);
        if (/\baudit:\s*false/.test(body) && !/\bauditReason:\s*"[^"]{10,}/.test(body)) violations.push(`${rel(file)}: ${name} verzichtet auf Audit ohne Begründung`);
      }
    }
    assert.deepEqual(violations, []);
  });
});

describe("Operationen: Namen und Erkennung", () => {
  const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
  const sources = files.filter((f) => !rel(f).startsWith("server/operations/")).map((f) => ({ file: rel(f), source: readFileSync(f, "utf8") }));

  it("jeder Aufruf von defineOperation wird von den Mustern der Architekturtests erkannt (auch mit Typargumenten) – keiner entgeht der Prüfung", () => {
    const missed: string[] = [];
    for (const { file, source } of sources) {
      const calls = [...source.matchAll(OPERATION_CALL)].length;
      const bodies = [...source.matchAll(OPERATION_BODY)].length;
      if (calls !== bodies) missed.push(`${file}: ${calls} Aufrufe, ${bodies} erkannt`);
    }
    assert.deepEqual(missed, []);
  });

  it("Operationsnamen sind eindeutig (sie sind Schlüssel für Hooks, Matrix, API-Zuordnung und Protokoll; die Registry überschriebe sonst still)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const { file, source } of sources) {
      for (const m of source.matchAll(OPERATION_BODY)) {
        const name = /name:\s*"([^"]+)"/.exec(m[1])?.[1];
        if (!name) continue;
        if (seen.has(name)) duplicates.push(`${name}: ${seen.get(name)} und ${file}`);
        else seen.set(name, file);
      }
    }
    assert.ok(seen.size > 50, `nur ${seen.size} Operationen gefunden`);
    assert.deepEqual(duplicates, []);
  });

  it("kein Modul heißt wie eine Datei im Modulordner (api, catalog, registry …): sonst würde featureTarget() seine Funktionen übersehen", () => {
    const clashes = [...new Set(FEATURES.map((f) => f.module))].filter((module) => MODULE_ROOT_FILES.has(module));
    assert.deepEqual(clashes, []);
  });
});

describe("Seitentitel (generateMetadata)", () => {
  /** Rumpf jeder `generateMetadata`-Funktion einer Datei (Klammern gezählt). */
  function metadataBodies(source: string): string[] {
    const bodies: string[] = [];
    for (const m of source.matchAll(/export async function generateMetadata\([^)]*\)[^{]*\{/g)) {
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      const start = i;
      while (depth > 0 && i < source.length) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }
      bodies.push(source.slice(start, i));
    }
    return bodies;
  }

  it("Titel, die aus der Datenbank kommen, werden erst nach der Rechteprüfung gelesen (Verhalten: app/metadata.test.ts)", () => {
    const unguarded: string[] = [];
    for (const file of walk(path.join(SRC, "app"))) {
      for (const body of metadataBodies(readFileSync(file, "utf8"))) {
        const readsDatabase = /\bdb\./.test(body);
        const guarded = /\b(sessionIfAllowed|getSession|requirePermission|requireSession)\(/.test(body);
        if (readsDatabase && !guarded) unguarded.push(path.relative(SRC, file).split(path.sep).join("/"));
      }
    }
    assert.deepEqual(unguarded, [], "generateMetadata liest die Datenbank ohne Rechteprüfung: sessionIfAllowed(\"<recht>\") vorschalten");
  });
});
