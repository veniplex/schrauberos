import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { isPlatformFeature } from "@/lib/api/scope";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { API_EXCEPTIONS } from "./api-exceptions";
import { FEATURES, featureOfPermission, fullFeatureId } from "./catalog";

/**
 * Vertrag der API mit der Oberfläche:
 *  - Plattform-/Verwaltungsfunktionen (Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit, API) sind nie API-Ressourcen,
 *  - jede `api.ts` einer Funktion ist in `src/modules/api.ts` eingetragen,
 *  - **jede schreibende UI-Aktion hat ein API-Pendant oder steht mit Begründung in `api-exceptions.ts`** (damit die API bei neuen Funktionen nicht driftet),
 *  - die API liest nie das Sitzungs-Cookie, die Oberfläche nie das Token.
 */
const SRC = path.resolve(process.cwd(), "src");

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full, match) : match(name) ? [full] : [];
  });
}
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

let env: TestEnv;
let endpoints: readonly import("@/server/api/types").ApiEndpoint[];
const operations = new Map<string, { name: string; permission: string }>();

before(async () => {
  env = await createTestEnv();
  endpoints = (await import("./api")).apiEndpoints;
  // alle Server Actions laden (wie die Berechtigungs-Matrix) und ihre Operationen einsammeln
  const files = walk(SRC, (n) => /\.tsx?$/.test(n) && !/\.test\./.test(n)).filter((f) => /\bdefineAction\(/.test(readFileSync(f, "utf8")) && !rel(f).startsWith("server/operations/"));
  for (const file of files) {
    const mod = (await import(`@/${rel(file).replace(/\.tsx?$/, "")}`)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (typeof value === "function" && "operation" in value) {
        const op = (value as unknown as { operation: { name: string; permission: string } }).operation;
        operations.set(op.name, op);
      }
    }
  }
});
after(() => env.cleanup());

describe("API: Registrierung und Ausnahmeliste", () => {
  it("Plattform-/Verwaltungsfunktionen sind nie API-Ressourcen (keine api.ts, keine Endpunkte)", () => {
    for (const file of walk(path.join(SRC, "modules"), (n) => n === "api.ts")) {
      const r = rel(file);
      if (r === "modules/api.ts") continue;
      assert.ok(!r.startsWith("modules/admin/"), `${r}: Verwaltung ist nie API-Ressource`);
      assert.match(r, /^modules\/[a-z]+\/[a-z]+\/api\.ts$/, `${r}: api.ts gehört in einen Funktionsordner`);
    }
    for (const e of endpoints) assert.ok(!isPlatformFeature(e.feature), `${e.operationId}: ${e.feature} ist Plattform/Verwaltung`);
    for (const f of FEATURES) if (f.module === "admin") assert.ok(!endpoints.some((e) => e.feature === fullFeatureId(f)), fullFeatureId(f));
  });

  it("jede api.ts einer Funktion ist in src/modules/api.ts eingetragen", () => {
    const registry = readFileSync(path.join(SRC, "modules", "api.ts"), "utf8");
    for (const file of walk(path.join(SRC, "modules"), (n) => n === "api.ts")) {
      const r = rel(file);
      if (r === "modules/api.ts") continue;
      assert.ok(registry.includes(`"./${r.replace(/^modules\//, "").replace(/\.ts$/, "")}"`), `${r} fehlt in modules/api.ts`);
    }
  });

  it("jede Funktion mit Endpunkten gehört zum Katalog, ihr Recht zu ihrer Rechte-Gruppe", () => {
    for (const e of endpoints) assert.equal(featureOfPermission(e.permission), e.feature, `${e.operationId}: ${e.permission} gehört nicht zu ${e.feature}`);
  });

  it("jede schreibende UI-Aktion hat ein API-Pendant oder steht mit Begründung auf der Ausnahmeliste", () => {
    assert.ok(operations.size >= 60, `nur ${operations.size} Aktionen gefunden`);
    const covered = new Set(endpoints.flatMap((e) => e.operations));
    const missing: string[] = [];
    for (const [name, op] of operations) {
      if (covered.has(name) || name in API_EXCEPTIONS) continue;
      // automatisch ausgenommen: Operationen jeder angemeldeten Person (Konto, Anzeigeeinstellungen) und der Plattform-/Verwaltungsfunktionen
      if (op.permission === "authenticated") continue;
      const feature = featureOfPermission(op.permission);
      if (feature && isPlatformFeature(feature)) continue;
      missing.push(`${name} (${op.permission})`);
    }
    assert.deepEqual(missing, [], "Diese UI-Aktionen haben kein API-Pendant: api.ts ergänzen oder mit Begründung in src/modules/api-exceptions.ts eintragen");
  });

  it("die Ausnahmeliste schrumpft nur: jeder Eintrag bezeichnet eine Operation ohne Endpunkt und hat eine Begründung", () => {
    const covered = new Set(endpoints.flatMap((e) => e.operations));
    const stale: string[] = [];
    for (const [name, reason] of Object.entries(API_EXCEPTIONS)) {
      if (!operations.has(name)) stale.push(`${name}: keine solche Operation mehr`);
      else if (covered.has(name)) stale.push(`${name}: hat inzwischen einen API-Endpunkt – bitte streichen`);
      assert.ok(reason.length >= 30, `${name}: Begründung fehlt`);
    }
    assert.deepEqual(stale, []);
  });

  it("jeder Endpunkt, der Operationen nennt, nennt nur bekannte", () => {
    for (const e of endpoints) for (const name of e.operations) assert.ok(operations.has(name), `${e.operationId}: Operation ${name} unbekannt`);
  });
});

describe("API: Cookie und Token bleiben getrennt", () => {
  const read = (dir: string) => walk(path.join(SRC, dir), (n) => /\.tsx?$/.test(n) && !/\.test\./.test(n));

  it("die API-Schicht liest nie ein Sitzungs-Cookie und benutzt nie die Sitzung der Oberfläche", () => {
    for (const file of read("server/api")) {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.ok(!/next\/headers|session-cookie|getSession|requireSession|requirePermission|cookies\(/.test(source), `${rel(file)} greift auf Cookie/Sitzung zu`);
    }
  });

  it("Sitzung und Seiten kennen den Authorization-Header nicht (Tokens gelten dort nie)", () => {
    for (const file of [...read("server/auth"), ...read("app").filter((f) => !rel(f).startsWith("app/api/v1/")), path.join(SRC, "proxy.ts")]) {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.ok(!/["']authorization["']|bearerToken|hashApiToken/i.test(source), `${rel(file)} wertet ein Token aus`);
    }
  });
});
