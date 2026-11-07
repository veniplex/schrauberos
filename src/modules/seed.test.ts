import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { FEATURES, fullFeatureId } from "./catalog";
import { ALL_PAGES } from "./pages";
import { ALL_SEEDS } from "./seed";

/**
 * Start- und Beispieldaten der Funktionen (`seed.ts`, eingesammelt in `seed.ts`): Jede Funktion mit einer `seed.ts` ist eingetragen, kennt nur sich selbst, und der Demo-Seed
 * deckt jede Seite der Routen-Inventur ab (Browser-CI-Regel aus CLAUDE.md: Seiten mit `[id]` brauchen Beispieldaten).
 */
const MODULES_DIR = path.resolve(process.cwd(), "src", "modules");

describe("Seeds der Funktionen: Registrierung", () => {
  it("jede seed.ts einer Funktion ist in src/modules/seed.ts eingetragen und meldet nur ihre eigene Funktion", () => {
    const onDisk: string[] = [];
    for (const mod of readdirSync(MODULES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const feature of readdirSync(path.join(MODULES_DIR, mod.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
        if (readdirSync(path.join(MODULES_DIR, mod.name, feature.name)).includes("seed.ts")) onDisk.push(`${mod.name}.${feature.name}`);
      }
    }
    assert.ok(onDisk.length >= 8, "seed.ts der Funktionen gefunden");
    const registered = new Set<string>(ALL_SEEDS.map((s) => s.feature));
    assert.deepEqual(onDisk.filter((f) => !registered.has(f)), [], "seed.ts vorhanden, aber nicht in src/modules/seed.ts eingetragen");
    assert.deepEqual([...registered].filter((f) => !onDisk.includes(f)), [], "Eintrag ohne seed.ts");
    const known = new Set<string>(FEATURES.map(fullFeatureId));
    for (const seed of ALL_SEEDS) assert.ok(known.has(seed.feature), `${seed.id}: unbekannte Funktion ${seed.feature}`);
  });

  it("Seed-Ids sind eindeutig, jede Seed liefert base oder demo", () => {
    assert.equal(new Set(ALL_SEEDS.map((s) => s.id)).size, ALL_SEEDS.length);
    for (const seed of ALL_SEEDS) assert.ok(seed.base || seed.demo, `${seed.id}: weder base noch demo`);
  });
});

describe("Demo-Seed deckt die Routen-Inventur ab", () => {
  let env: TestEnv;
  before(async () => {
    env = await createTestEnv();
    await (await import("@/server/seed/base")).ensureBaseData(env.db);
    await (await import("@/server/seed/demo")).seedAllDemo(env.db);
  });
  after(() => env.cleanup());

  it("zu jedem Seed-Verweis (Tabelle, Bedingung) einer Seite gibt es mindestens eine Zeile", async () => {
    // Benutzer entstehen nicht im Demo-Seed, sondern bei Einrichtung/Entwicklungs-Seed (prisma/seed.ts): hier ausgenommen
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const page of ALL_PAGES) {
      for (const param of Object.values(page.params ?? {})) {
        if (!("table" in param) || param.table === "User") continue;
        const key = `${param.table}|${param.where ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rows = (await env.db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "${param.table}"${param.where ? ` WHERE ${param.where}` : ""}`)) as Array<{ n: number | bigint }>;
        if (Number(rows[0].n) === 0) missing.push(`${page.path}: keine Zeile in ${param.table}${param.where ? ` (${param.where})` : ""}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("zweiter Lauf legt nichts doppelt an", async () => {
    const count = async () => Number(((await env.db.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM "Customer") + (SELECT COUNT(*) FROM "Vehicle") + (SELECT COUNT(*) FROM "TireSet") + (SELECT COUNT(*) FROM "Appointment") + (SELECT COUNT(*) FROM "Invoice") + (SELECT COUNT(*) FROM "Employee") + (SELECT COUNT(*) FROM "DocPage") AS n`)) as Array<{ n: number | bigint }>)[0].n);
    const before = await count();
    await (await import("@/server/seed/demo")).seedAllDemo(env.db);
    assert.equal(await count(), before);
  });
});
