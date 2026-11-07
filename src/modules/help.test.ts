import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { featureOfPermission, FEATURES, fullFeatureId, type Permission } from "./catalog";
import { ALL_HELP_TOPICS, helpFor } from "./help";

const DOCS = path.resolve(process.cwd(), "docs");
const docFile = (doc: string) => path.join(DOCS, `${doc}.md`);

const allDocs = (dir = DOCS): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? allDocs(full) : full.endsWith(".md") ? [path.relative(DOCS, full).split(path.sep).join("/").replace(/\.md$/, "")] : [];
  });

/** Eine Anmeldung, die genau diese Funktionen aktiv hat und alle Rechte besitzt. */
const sessionWith = (active: string[]) => ({
  features: new Set(active),
  can: (p: Permission) => active.includes(featureOfPermission(p) ?? ""),
});

describe("Hilfe-Themen der Funktionen", () => {
  it("haben eindeutige Adressen, die zu keinem Plattform-Kapitel passen können (enthalten einen Punkt)", () => {
    const ids = ALL_HELP_TOPICS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z]+\.[a-z0-9.-]+$/, id);
  });

  it("gehören zu einer bekannten Funktion, deren Recht sie voraussetzen, und zeigen auf eine vorhandene Datei mit Titel", () => {
    const features = new Set(FEATURES.map(fullFeatureId));
    for (const topic of ALL_HELP_TOPICS) {
      assert.ok(features.has(topic.feature), `${topic.id}: Funktion ${topic.feature} unbekannt`);
      assert.equal(featureOfPermission(topic.permission), topic.feature, `${topic.id}: Recht ${topic.permission} gehört nicht zur Funktion`);
      assert.ok(existsSync(docFile(topic.doc)), `${topic.id}: docs/${topic.doc}.md fehlt`);
      assert.match(readFileSync(docFile(topic.doc), "utf8"), /^# .+/m, `${topic.id}: Titel (# …) fehlt`);
    }
  });

  it("decken alle Dateien unter docs/ ab (außer den Plattform-Kapiteln)", () => {
    const used = new Set(ALL_HELP_TOPICS.map((t) => t.doc));
    const orphans = allDocs().filter((d) => !d.startsWith("platform/") && !used.has(d));
    assert.deepEqual(orphans, []);
  });

  it("hat jede Funktion mit Oberfläche mindestens ein Kapitel", () => {
    const covered = new Set(ALL_HELP_TOPICS.map((t) => t.feature));
    assert.deepEqual(FEATURES.map(fullFeatureId).filter((id) => !covered.has(id)), []);
  });
});

describe("helpFor", () => {
  const everything = FEATURES.map(fullFeatureId);

  it("gliedert nach Modulen in der Reihenfolge der Navigation", () => {
    const groups = helpFor(sessionWith(everything));
    assert.deepEqual(groups.map((g) => g.module), ["workshop", "office", "it", "handbook", "admin"]);
    assert.deepEqual(groups[0].topics.map((t) => t.id), ["workshop.appointments", "workshop.orders", "workshop.tires", "workshop.parts", "workshop.files", "workshop.checklists", "workshop.customers", "workshop.customers.privacy", "workshop.vehicles"]);
  });

  it("blendet Kapitel ausgeschalteter Funktionen aus – und Module, die dadurch leer werden", () => {
    const withoutFleet = helpFor(sessionWith(everything.filter((id) => id !== "office.fleet")));
    assert.ok(!withoutFleet.flatMap((g) => g.topics).some((t) => t.id === "office.fleet"));
    assert.ok(withoutFleet.some((g) => g.module === "office"));

    const withoutIt = helpFor(sessionWith(everything.filter((id) => !id.startsWith("it."))));
    assert.ok(!withoutIt.some((g) => g.module === "it"));
  });

  it("zeigt nur Kapitel zu Funktionen, deren Recht die Anmeldung hat", () => {
    const groups = helpFor({ features: new Set(everything), can: (p: Permission) => p === "invoices.view" });
    assert.deepEqual(groups.flatMap((g) => g.topics.map((t) => t.id)), ["office.invoices"]);
  });
});
