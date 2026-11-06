import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FEATURES, fullFeatureId } from "./catalog";
import { ALL_PAGES, PLATFORM_PAGES } from "./pages";

/**
 * Routen-Inventur für die Browser-CI: Jede Funktion meldet ihre Seiten (`pages.ts`); dieser Test hält die Liste ehrlich – gegen den Katalog,
 * die Navigation und die Routen im Verzeichnis `src/app`.
 */
const APP = path.resolve(process.cwd(), "src", "app");

/** Alle Seiten unter `src/app` als Routenmuster ohne Routengruppen, z. B. "/customers/[id]/edit". */
function routesOnDisk(dir = APP, prefix = ""): Array<{ route: string; file: string }> {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routesOnDisk(full, /^\(.*\)$/.test(name) ? prefix : `${prefix}/${name}`);
    return name === "page.tsx" ? [{ route: prefix || "/", file: full }] : [];
  });
}
const disk = routesOnDisk();
/** Pfad mit eingesetzten festen Werten (z. B. "/docs/[area]" mit area=it → "/docs/it"). */
const withLiterals = (page: { path: string; params?: Record<string, { value: string } | { table: string }> }) =>
  page.path.replace(/\[(\w+)\]/g, (all, name: string) => {
    const param = page.params?.[name];
    return param && "value" in param ? param.value : all;
  });
const claimed = new Set<string>([...ALL_PAGES.map((p) => p.path), ...PLATFORM_PAGES.map((p) => p.path)]);

describe("Routen-Inventur (Seitenlisten der Funktionen)", () => {
  it("jede Funktion des Katalogs bringt eine Seitenliste mit", () => {
    const missing = FEATURES.map(fullFeatureId).filter((id) => !ALL_PAGES.some((p) => p.feature === id));
    assert.deepEqual(missing, [], "Diese Funktionen melden keine Seiten: pages.ts anlegen (definePages) und in src/modules/pages.ts eintragen");
  });

  it("jede Seitenliste hat mindestens eine Liste oder Übersicht und gehört zu einer Funktion des Katalogs", () => {
    const known = new Set<string>(FEATURES.map(fullFeatureId));
    for (const page of ALL_PAGES) assert.ok(known.has(page.feature), `${page.path}: unbekannte Funktion ${page.feature}`);
    for (const id of known) {
      const pages = ALL_PAGES.filter((p) => p.feature === id);
      assert.ok(pages.some((p) => p.kind === "list" || p.kind === "other"), `${id}: keine Listen-/Übersichtsseite`);
    }
  });

  it("jede gemeldete Seite gibt es als Route, und die Platzhalter sind belegt", () => {
    const routes = new Set(disk.map((d) => d.route));
    for (const page of [...ALL_PAGES, ...PLATFORM_PAGES]) {
      assert.ok(routes.has(page.path), `${page.path}: keine solche Seite unter src/app`);
      const placeholders = [...page.path.matchAll(/\[(\w+)\]/g)].map((m) => m[1]).sort();
      assert.deepEqual(Object.keys(page.params ?? {}).sort(), placeholders, `${page.path}: params passen nicht zu den Platzhaltern`);
    }
  });

  it("jede Seite unter src/app (Anwendungsrahmen) ist gemeldet – keine Seite fehlt in der Inventur", () => {
    // Außerhalb der Inventur: die Ersteinrichtung (nur vor dem ersten Benutzer erreichbar, eigener Test) und die Testseiten der Browser-CI
    // für absichtliche Fehlerzustände (nur mit SCHRAUBEROS_E2E=1 erreichbar, sonst 404; geprüft in e2e/tests/states.spec.ts)
    const exempt = new Set(["/setup", "/e2e-state/[state]", "/e2e-fault/[state]"]);
    const unlisted = disk.map((d) => d.route).filter((r) => !claimed.has(r) && !exempt.has(r));
    assert.deepEqual(unlisted, [], "Diese Seiten fehlen in einer pages.ts (oder PLATFORM_PAGES)");
  });

  it("alle Navigationseinträge zeigen auf eine gemeldete Seite derselben Funktion, mit passendem Recht", () => {
    for (const feature of FEATURES) {
      const id = fullFeatureId(feature);
      for (const nav of feature.nav) {
        const page = ALL_PAGES.find((p) => p.feature === id && withLiterals(p) === nav.href && !p.query);
        assert.ok(page, `Navigation ${nav.href} (${id}) fehlt in der Seitenliste`);
        assert.equal(page.permission, nav.permission, `${nav.href}: Recht der Navigation und der Seitenliste weichen ab`);
      }
    }
  });

  it("das Recht jeder Seite gehört zur Rechte-Gruppe der Funktion und entspricht dem requirePermission der Seite", () => {
    for (const page of ALL_PAGES) {
      const feature = FEATURES.find((f) => fullFeatureId(f) === page.feature)!;
      assert.ok((feature.permissions.keys as readonly string[]).includes(page.permission), `${page.path}: ${page.permission} gehört nicht zu ${page.feature}`);
      const file = disk.find((d) => d.route === page.path)!.file;
      const literal = [...readFileSync(file, "utf8").matchAll(/requirePermission\(\s*"([\w.]+)"\s*\)/g)].map((m) => m[1]);
      // Seiten mit genau einer festen Rechteprüfung müssen übereinstimmen (Seiten mit dynamischer Prüfung, z. B. Dokumentation, werden übersprungen)
      if (literal.length === 1 && !page.query) assert.equal(literal[0], page.permission, `${page.path}: die Seite verlangt ${literal[0]}`);
    }
  });

  it("Seed-Verweise nennen Tabelle des Schemas", () => {
    const schema = readFileSync(path.resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
    for (const page of [...ALL_PAGES, ...PLATFORM_PAGES]) {
      for (const param of Object.values(page.params ?? {})) {
        if ("table" in param) assert.match(schema, new RegExp(`^model ${param.table} \{`, "m"), `${page.path}: unbekannte Tabelle ${param.table}`);
      }
    }
    assert.ok(existsSync(APP));
  });
});
