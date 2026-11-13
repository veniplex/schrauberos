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
const COMPOSITION_ROOTS = new Set(["modules/catalog.ts", "modules/registry.ts", "modules/help.ts", "modules/pages.ts", "modules/operation-hooks.ts", "modules/api.ts", "modules/jobs.ts", "modules/secrets.ts", "modules/exchange.ts", "modules/seed.ts", "modules/privacy.ts", "modules/webhooks.ts"]);
/** Dateien im Modul-Wurzelordner, die Plattform-Code importieren darf (Katalog, Aktivierung, Registry …). */
const MODULE_ROOT_FILES = new Set(["catalog", "catalog-logic", "define", "features", "help", "pages", "registry", "types", "default-roles", "operation-hooks", "api", "jobs", "secrets", "exchange", "seed", "privacy", "webhooks"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

type Import = { spec: string; line: number };

function importsOf(file: string): Import[] {
  return importsOfText(readFileSync(file, "utf8"));
}

function importsOfText(source: string): Import[] {
  const result: Import[] = [];
  source
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
  const m = /^modules\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)(?:\/(.+))?$/.exec(resolved);
  if (!m || MODULE_ROOT_FILES.has(m[1])) return null;
  // modules/<datei> (z. B. modules/catalog) sind keine Funktionen; module.ts liegt direkt im Modulordner
  if (!m[3] && !FEATURES.some((f) => f.module === m[1] && f.id === m[2])) return null;
  return { id: `${m[1]}.${m[2]}`, rest: m[3] ?? "" };
}

const featureById = new Map(FEATURES.map((f) => [featureKey(f), f]));

/** Wem gehört eine Datei? Funktionsordner unter modules, Seiten über ihre Route. */
function ownerOf(rel: string): string | null {
  const m = /^modules\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\//.exec(rel);
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
        if (target.rest !== "public" && target.rest !== "client") violations.push(`${rel}:${imp.line} importiert ${imp.spec} (nur ${target.id}/public bzw. client erlaubt)`);
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

  it("Client-Bündel: Client-Komponenten (und alles, was sie importieren) erreichen keinen Server-Code", () => {
    // Wurzeln: Dateien mit "use client" und die client.ts der Funktionen (der Einstieg für Client-Komponenten anderer Funktionen).
    // Server-Code im Browserbündel = Seite 500 in next dev / Bruch im next build; Tests laden alles als Node-Module und sehen es nie.
    const fileSet = new Set(files.map((f) => path.relative(SRC, f).split(path.sep).join("/")));
    const info = new Map<string, { directive: string | null; imports: string[]; serverish: boolean }>();
    const importRe = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const source = readFileSync(file, "utf8");
      const directive = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use (client|server)["']/.exec(source)?.[1] ?? null;
      const imports: string[] = [];
      let serverish = false;
      for (const m of source.matchAll(importRe)) {
        const spec = m[3] ?? m[4] ?? m[5];
        if (!spec) continue;
        // reine Typimporte (`import type …`, `import { type A }`) entfallen beim Übersetzen
        const named = m[2]?.trim().match(/^\{([^}]*)\}$/);
        if (m[1] || (named && named[1].split(",").map((p) => p.trim()).filter(Boolean).every((p) => p.startsWith("type ")))) continue;
        if (spec === "server-only" || spec.startsWith("node:") || spec === "@prisma/client" || spec.startsWith("@/generated/") || spec === "better-sqlite3") serverish = true;
        const resolved = resolve(file, spec);
        if (!resolved) continue;
        const hit = [`${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`].find((c) => fileSet.has(c));
        if (hit) imports.push(hit);
      }
      info.set(rel, { directive, imports, serverish });
    }
    const roots = [...info.keys()].filter((rel) => info.get(rel)!.directive === "client" || /^modules\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\/client\.ts$/.test(rel));
    assert.ok(roots.length > 50, "Client-Wurzeln gefunden");
    const violations = new Set<string>();
    for (const root of roots) {
      const via = new Map<string, string | null>([[root, null]]);
      const queue = [root];
      while (queue.length) {
        const rel = queue.shift()!;
        const entry = info.get(rel)!;
        // Server Actions ("use server") ersetzt das Browserbündel durch Verweise: ihr Inhalt gelangt nicht dorthin
        if (rel !== root && entry.directive === "server") continue;
        if (entry.serverish) {
          const chain: string[] = [];
          for (let c: string | null | undefined = rel; c; c = via.get(c)) chain.unshift(c);
          violations.add(chain.join(" -> "));
          continue;
        }
        for (const next of entry.imports) {
          if (via.has(next)) continue;
          via.set(next, rel);
          queue.push(next);
        }
      }
    }
    assert.deepEqual([...violations].sort(), []);
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
  "platform/account/key-recovery-actions.ts": "Schlüssel wiederherstellen vor der Anmeldung: der 256-Bit-Wiederherstellungsschlüssel statt Recht, global gedrosselt (loginThrottle.recoveryKey), nur im Störungsfall wirksam",
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
      const m = /^modules\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\/jobs\.ts$/.exec(rel);
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
      const m = /^modules\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\/jobs\.ts$/.exec(rel);
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
      const m = /^modules\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\/secrets\.ts$/.exec(rel);
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
      const m = /^modules\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\//.exec(rel);
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

/**
 * Modulautonomie (P1c-1): Die Zuordnung von Dateien zu Funktionen darf nicht an ungewöhnlichen IDs scheitern, und jede Route gehört einer Funktion oder der Plattform.
 */
describe("Modulautonomie", () => {
  const relOf = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

  it("Funktions-IDs sind tolerant gegenüber Ziffern und Bindestrichen (sonst entginge z. B. `time-tracking` der Importprüfung)", () => {
    const target = featureTarget("modules/office/time-tracking/queries");
    assert.deepEqual(target, { id: "office.time-tracking", rest: "queries" });
    assert.equal(featureTarget("modules/office/time-tracking/public")?.rest, "public");
    assert.equal(featureTarget("modules/catalog"), null);
  });

  it("jeder Ordner unter src/modules/<modul>/ ist eine Funktion des Katalogs (keine Funktion ohne Eintrag, die der Prüfung entgeht)", () => {
    const modulesDir = path.join(SRC, "modules");
    const unregistered: string[] = [];
    for (const mod of readdirSync(modulesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const dir of readdirSync(path.join(modulesDir, mod.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const id = `${mod.name}.${dir.name}`;
        if (!featureById.has(id)) unregistered.push(id);
        assert.match(dir.name, /^[a-z][a-z0-9-]*$/, `${id}: Ordnername nicht als Funktions-ID erlaubt`);
      }
    }
    assert.deepEqual(unregistered, [], "Ordner unter modules/<modul>/ ohne Eintrag in catalog.ts");
  });

  /** Plattform-Route Handler (keiner Funktion zugeordnet) – mit Begründung. Neue Route Handler gehören der Funktion (`routes` in der `feature.ts`), nicht hierher. */
  const PLATFORM_API_ROUTES: Record<string, string> = {
    "api/health": "Gesundheitsprüfung des Containers",
    "api/logo": "Werkstatt-Logo aus dem Profil (Plattform): öffentlich lesbar, nur Rasterbilder, für Anmeldeseite und Kopfzeile",
    "api/search": "Schnellsuche: aggregiert die Anbieter der Funktionen (registry.ts)",
    "api/setup": "Wiederherstellung bei der Einrichtung vor dem ersten Benutzer",
    "api/exchange": "CSV-Austausch: ein Rahmen für alle Datenarten (server/csv), die Funktionen liefern Spalten und Rechte (modules/exchange.ts)",
    "api/docs": "Bilder der Querschnittsfunktion Dokumentation (capabilities/docs)",
    "api/v1": "Programmierschnittstelle: ein Rahmen für alle Ressourcen (server/api), die Funktionen liefern `api.ts` (modules/api.ts)",
  };
  const routeFiles = walk(path.join(SRC, "app")).filter((f) => /\/route\.ts$/.test(f.split(path.sep).join("/")));
  const urlOf = (file: string) =>
    relOf(file)
      .replace(/^app\//, "")
      .replace(/\/route\.ts$/, "")
      .split("/")
      .filter((seg) => !/^\(.+\)$/.test(seg))
      .join("/");

  it("jeder Route Handler unter app/api gehört einer Funktion (routes in der feature.ts) oder steht mit Begründung in PLATFORM_API_ROUTES", () => {
    const unowned: string[] = [];
    for (const file of routeFiles) {
      const url = urlOf(file);
      if (!url.startsWith("api/")) continue;
      const platform = Object.keys(PLATFORM_API_ROUTES).some((p) => url === p || url.startsWith(`${p}/`));
      if (!platform && !ownerOf(relOf(file))) unowned.push(url);
    }
    assert.deepEqual(unowned, [], "Route Handler ohne Funktion: `routes` der feature.ts ergänzen (z. B. \"api/<name>\") oder begründet in PLATFORM_API_ROUTES");
    for (const [prefix, reason] of Object.entries(PLATFORM_API_ROUTES)) {
      assert.ok(reason.length > 10, `${prefix}: Begründung fehlt`);
      assert.ok(routeFiles.some((f) => urlOf(f) === prefix || urlOf(f).startsWith(`${prefix}/`)), `${prefix}: kein Route Handler mehr – Eintrag streichen`);
      assert.ok(!FEATURES.some((f) => f.routes.some((r) => r === prefix || r.startsWith(`${prefix}/`))), `${prefix}: gehört einer Funktion – aus PLATFORM_API_ROUTES streichen`);
    }
  });

  it("keine verwaiste Route: jeder Eintrag `routes` einer Funktion hat eine Seite oder einen Route Handler", () => {
    const urls = walk(path.join(SRC, "app"))
      .filter((f) => /\/(page\.tsx|route\.ts)$/.test(f.split(path.sep).join("/")))
      .map((f) => relOf(f).replace(/^app\//, "").replace(/\/(page\.tsx|route\.ts)$/, "").split("/").filter((seg) => !/^\(.+\)$/.test(seg)).join("/"));
    const orphans: string[] = [];
    for (const f of FEATURES) {
      for (const route of f.routes) if (!urls.some((u) => u === route || u.startsWith(`${route}/`))) orphans.push(`${featureKey(f)}: ${route}`);
    }
    assert.deepEqual(orphans, []);
  });

  it("das Seed-Skript (prisma/seed.ts) erreicht kein `server-only` – es läuft außerhalb von Next.js (Hilfsmittel: server/db-client.ts)", () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      if (/["']server-only["']/.test(text)) offenders.push(path.relative(path.resolve(SRC, ".."), file).split(path.sep).join("/"));
      // Nur Laufzeit-Importe: `import type` wird beim Übersetzen entfernt
      const runtime = text
        .split("\n")
        .filter((line) => !/^\s*(?:import|export)\s+type\b/.test(line))
        .join("\n");
      for (const imp of importsOfText(runtime)) {
        const target = imp.spec.startsWith("@/") ? path.join(SRC, imp.spec.slice(2)) : imp.spec.startsWith(".") ? path.resolve(path.dirname(file), imp.spec) : null;
        if (!target) continue;
        const resolved = [".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => target + ext).find((candidate) => {
          try {
            return statSync(candidate).isFile();
          } catch {
            return false;
          }
        });
        if (resolved) visit(resolved);
      }
    };
    visit(path.resolve(SRC, "..", "prisma", "seed.ts"));
    assert.ok(seen.size > 20, `nur ${seen.size} Dateien erreicht – Auflösung der Importe prüfen`);
    assert.deepEqual(offenders, []);
  });
});

/**
 * Datenzugriff (P1c-2, README „Datenzugriff“): Seiten, Dashboard-Bausteine, Suche und API holen Daten mit sensiblen Spalten nur über die `queries.ts` ihrer Funktion
 * (explizites `select`, Betrachter-Parameter). Statisch prüfbar ist: kein roher Zugriff auf die Tabellen der Mitarbeiter in Seiten und Bausteinen, kein Lesen des Notfallkontakts
 * dort, keine Voll-Relationen auf Kunden/Mitarbeiter. Das Verhalten (kein sensibles SQL ohne Recht) prüfen die Tests der `queries.ts`.
 */
describe("Datenzugriff", () => {
  const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
  const isPage = (r: string) => r.startsWith("app/") && !r.startsWith("app/api/");
  const isWidget = (r: string) => /^modules\/[a-z0-9-]+\/[a-z0-9-]+\/widgets\.tsx$/.test(r);
  const sources = files.map((file) => ({ file: rel(file), text: readFileSync(file, "utf8") }));

  it("Seiten und Dashboard-Bausteine lesen die Tabellen der Mitarbeiter (Employee, Absence, Qualification) nie direkt – nur über employees/queries.ts bzw. employees/public.ts", () => {
    const direct = /\bdb\.(employee|absence|qualification)\b/;
    const offenders = sources.filter(({ file, text }) => (isPage(file) || isWidget(file)) && direct.test(text)).map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  /** Ohne Zeichenketten (Übersetzungsschlüssel wie "employees.fields.emergencyName") und Kommentarzeilen. */
  const code = (text: string) =>
    text
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
      .join("\n")
      .replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, '""');

  it("Seiten, Bausteine, Suche und API lesen den Notfallkontakt nicht aus Datenbankzeilen (`.emergencyName` …): er kommt als `emergency` nur aus getEmployeeForEdit/getEmployeeDetail", () => {
    const read = /\.\s*emergency(?:Name|Phone|Relation)\b/;
    const offenders = sources.filter(({ file, text }) => (isPage(file) || isWidget(file) || /\/(search|api)\.ts$/.test(file)) && read.test(code(text))).map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  it("Seiten lesen die Kundentabelle nie direkt (db.customer): Kunden kommen über customers/queries.ts bzw. customers/public.ts", () => {
    const offenders = sources.filter(({ file, text }) => isPage(file) && /\bdb\.customer\b/.test(text)).map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  /**
   * Die Art.-18-Bedingung (eingeschränkte Verarbeitung, `processingRestrictedAt`) steht nur in `customers/` (Modul und Kundenseiten); alle anderen Funktionen fragen über die Helfer aus `customers/public.ts`
   * (`unrestrictedCustomerWhere`, `restrictedCustomerWhere`, `searchableCustomerWhere`, `restrictionSelect`/`usabilitySelect` + `isRestricted`/`isUnusable`, `unrestrictedBy…`). Eine künftige Änderung der
   * Auslegung geschieht dann an einer Stelle (Z6-3 M-4). Die Liste der Altlasten bleibt leer; Einträge dürfen nur verschwinden.
   */
  const ART18_LEGACY: Record<string, string> = {};
  const inCustomers = (file: string) => file.startsWith("modules/workshop/customers/") || file.startsWith("app/(app)/(workshop)/customers/");
  const violatesArt18 = (file: string, text: string) => !inCustomers(file) && /processingRestrictedAt/.test(code(text));

  it("`processingRestrictedAt` kommt nur in customers/ vor (Modul und Kundenseiten) – sonst die Helfer aus customers/public.ts", () => {
    const offenders = sources.filter(({ file, text }) => !(file in ART18_LEGACY) && violatesArt18(file, text)).map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  it("die Liste der Art.-18-Altlasten schrumpft nur: jeder Eintrag verletzt die Regel noch und die Datei existiert", () => {
    for (const [file, reason] of Object.entries(ART18_LEGACY)) {
      const source = sources.find((s) => s.file === file);
      assert.ok(source, `${file}: Datei gibt es nicht mehr – Eintrag streichen`);
      assert.ok(violatesArt18(source.file, source.text), `${file}: verletzt die Regel nicht mehr – Eintrag streichen`);
      assert.ok(reason.length >= 20, `${file}: Begründung fehlt`);
    }
  });

  it("keine Voll-Relationen auf Kunden und Mitarbeiter (`include: { customer: true }`): immer `select` – `customerNameSelect` für den Namen, `customerContacts` für Kontaktdaten", () => {
    const wildcard = /\b(?:customer|employee|driver)\s*:\s*true\b/;
    const offenders = sources.filter(({ file, text }) => (file.startsWith("app/") || file.startsWith("modules/")) && !/\/seed\.ts$/.test(file) && wildcard.test(code(text))).map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  it("IT-Tresor: die Tabelle VaultEntry berühren nur it/docs/vault*.ts (Anzeige, Operationen, Abfragen, Zurücksetzen) – Seiten, Bausteine, Suche, API, Export und andere Funktionen nie; Ausnahmen mit Grund", () => {
    const ALLOWED = /^modules\/it\/docs\/vault[a-z-]*\.tsx?$/;
    const EXCEPTIONS: Record<string, string> = {
      "modules/it/docs/seed.ts": "Demo-Seed: ein Beispiel-Eintrag ohne Zugangsdaten",
    };
    /** Roh-SQL auf die Tabelle (`$queryRaw`, `better-sqlite3`): der Tabellenname steht in einem Text – `code()` ersetzt Texte, hier zählen sie. Nur Kommentarzeilen bleiben außen vor. */
    const RAW_EXCEPTIONS: Record<string, string> = {
      "modules/it/docs/pages.ts": "Routen-Inventur (Browser-CI): nennt die Tabelle als Namen für die ID der Seite, liest nichts",
    };
    const comments = (text: string) =>
      text
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
        .join("\n");
    const offenders = sources
      .filter(({ file, text }) => !/\.test\.tsx?$/.test(file) && !ALLOWED.test(file) && !(file in EXCEPTIONS) && /\bvaultEntry\b/i.test(code(text)))
      .map(({ file }) => file);
    assert.deepEqual(offenders, [], "Zugriff auf VaultEntry außerhalb von it/docs/vault*.ts");
    const rawOffenders = sources
      .filter(({ file, text }) => !/\.test\.tsx?$/.test(file) && !ALLOWED.test(file) && !(file in RAW_EXCEPTIONS) && !(file in EXCEPTIONS) && /\bVaultEntry\b/.test(comments(text)))
      .map(({ file }) => file);
    assert.deepEqual(rawOffenders, [], "Roh-SQL auf VaultEntry außerhalb von it/docs/vault*.ts");
    for (const file of Object.keys(RAW_EXCEPTIONS)) assert.ok(sources.some((s) => s.file === file && /\bVaultEntry\b/.test(comments(s.text))), `${file}: Ausnahme nicht mehr nötig – bitte streichen`);
    for (const file of Object.keys(EXCEPTIONS)) assert.ok(sources.some((s) => s.file === file && /\bvaultEntry\b/.test(code(s.text))), `${file}: Ausnahme nicht mehr nötig – bitte streichen`);
    // Wer entschlüsseln kann (vault-crypto), sind nur die Operationen und das Zurücksetzen – nie eine Seite, ein Baustein, die Suche oder eine andere Funktion
    const crypto = sources.filter(({ file, text }) => !/\.test\.tsx?$/.test(file) && !ALLOWED.test(file) && /vault-crypto/.test(text)).map(({ file }) => file);
    assert.deepEqual(crypto, [], "vault-crypto wird außerhalb von it/docs/vault*.ts importiert");
    const pages = sources.filter(({ file, text }) => (isPage(file) || isWidget(file)) && /openVaultEntry|sealVaultEntry|encryptSecretBound|decryptSecretBound/.test(text)).map(({ file }) => file);
    assert.deepEqual(pages, []);
  });

  it("die API der Mitarbeiter liest nur die Spalten ohne besonders geschützte Daten (select) und nie Krankheit (scope)", () => {
    const api = readFileSync(path.join(SRC, "modules/office/employees/api.ts"), "utf8");
    assert.match(api, /select:\s*employeeBaseSelect/);
    assert.match(api, /scope:\s*\{\s*type:\s*\{\s*not:\s*"sick"/);
  });
});

/**
 * Zeitzone (P1c-3): Tage, Uhrzeiten, Wochen und Monate der Werkstatt rechnen in der **Werkstatt-Zone** (`src/lib/zone.ts`), nie in der Prozess-Zone (`TZ`). Statisch prüfbar:
 * kein `date-fns` (die Gegenstücke stehen in `zone.ts`), keine Ortszeit-Zugriffe auf `Date` (`getHours`, `setDate` …) und keine Ortszeit-Konstruktoren (`new Date(2026, 0, 1)`,
 * `new Date("…T12:00:00")` ohne Zone) im Produktivcode; `process.env.TZ` liest nur `zone.ts` (Rückfall), geschrieben wird es nur in `startup.ts` (Kompatibilität).
 */
describe("Zeitzone", () => {
  const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
  const sources = files.map((file) => ({ file: rel(file), text: readFileSync(file, "utf8") }));
  /** Ohne Kommentarzeilen. */
  const code = (text: string) =>
    text
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
      .join("\n");
  const production = sources.filter(({ file }) => !file.startsWith("launcher/") && !file.startsWith("test/"));

  it("kein date-fns im Produktivcode: Tagesrechnung steht in lib/zone.ts (gleiche Namen, Zone als letzter Parameter)", () => {
    const offenders = production.filter(({ text }) => /from\s+["']date-fns(?:\/[^"']*)?["']/.test(text)).map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  it("keine Ortszeit-Zugriffe auf Date (getHours, getDate, getDay, getMonth, getFullYear, setHours …): sie rechnen in der Prozess-Zone", () => {
    const local = /\.(?:getHours|getMinutes|getSeconds|getDate|getDay|getMonth|getFullYear|setHours|setMinutes|setSeconds|setDate|setMonth|setFullYear)\(/;
    const offenders = production.filter(({ text }) => local.test(code(text))).map(({ file }) => file);
    assert.deepEqual(offenders, [], "stattdessen getHours(date)/getDay(date)/… aus @/lib/zone (Zone: Werkstatt-Zone)");
  });

  it("keine Ortszeit-Konstruktoren: `new Date(2026, 0, 1)` und `new Date(\"…T12:00:00\")` ohne Zone meinen die Prozess-Zone", () => {
    const parts = /new Date\(\s*[\w.]+\s*,\s*[\w.+ -]+\s*,\s*[\w.+ -]+/; // mehrere Zahlen: Jahr, Monat, Tag …
    const wall = /new Date\(\s*`[^`]*T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?`\s*\)/; // Datum-Uhrzeit ohne Z/Versatz
    const offenders = production.filter(({ text }) => parts.test(code(text)) || wall.test(code(text))).map(({ file }) => file);
    assert.deepEqual(offenders, [], "stattdessen noon(day), startOfDayIn(day), parseLocalDateTime(day, time) aus @/lib/dates bzw. instantOf aus @/lib/zone");
  });

  it("process.env.TZ lesen nur zone.ts (Rückfall) und startup.ts; schreiben nur startup.ts (applyTimezone, Kompatibilität)", () => {
    const offenders = production.filter(({ file, text }) => /process\.env\.TZ/.test(code(text)) && !["lib/zone.ts", "server/startup.ts"].includes(file)).map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  it("Zeitpunkte werden in der Oberfläche in der Werkstatt-Zone angezeigt: getI18n übergibt workshopZone() an den Übersetzer", () => {
    const server = readFileSync(path.join(SRC, "i18n/server.ts"), "utf8");
    assert.match(server, /createTranslator\(locale, dictionaries\[locale\], workshopZone\(\)\)/);
  });
});
