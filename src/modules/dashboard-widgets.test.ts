import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { pickWidgets } from "@/lib/dashboard";
import { ALL_PERMISSIONS, FEATURES, fullFeatureId } from "./catalog";
import { DEFAULT_ROLES } from "./default-roles";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";

let env: TestEnv;
let registry: typeof import("./registry");
before(async () => {
  env = await createTestEnv();
  registry = await import("./registry");
});
after(() => env.cleanup());

const lookup = (tree: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);

describe("Bausteine der Funktionen", () => {
  it("jeder Baustein hat eine Überschrift (beide Sprachen) und eine Priorität; Baustein-IDs sind eindeutig", () => {
    const catalog = registry.widgetCatalog();
    assert.ok(catalog.length >= 10);
    assert.equal(new Set(catalog.map((c) => c.id)).size, catalog.length);
    for (const widget of catalog) {
      for (const tree of [de, en]) assert.equal(typeof lookup(tree, widget.titleKey), "string", widget.titleKey);
    }
  });

  /** Eine Sitzung mit den Rechten einer Standardrolle und allen Funktionen eingeschaltet. */
  const sessionOf = (permissions: ReadonlySet<string>, features: ReadonlySet<string> = new Set(FEATURES.map(fullFeatureId))) =>
    ({ features, permissions, can: (p: string) => permissions.has(p) }) as never;

  it("jede Standardrolle: höchstens vier Bausteine offen, der Rest zugeklappt – nichts geht verloren; die Wichtigsten kommen zuerst", () => {
    for (const role of DEFAULT_ROLES) {
      const permissions = new Set<string>(role.isAdmin ? ALL_PERMISSIONS : role.permissions);
      const allowed = registry.widgetsFor(sessionOf(permissions));
      const picked = pickWidgets(allowed);
      assert.ok(picked.shown.length <= 4, role.key);
      assert.equal(picked.shown.length + picked.more.length, allowed.length, role.key);
      const worstShown = Math.max(...picked.shown.map((x) => x.priority), 0);
      for (const hidden of picked.more) assert.ok(hidden.priority >= worstShown, `${role.key}: ${hidden.id} ist weniger wichtig als alles Offene`);
    }
    const ids = (role: string) => pickWidgets(registry.widgetsFor(sessionOf(new Set(DEFAULT_ROLES.find((r) => r.key === role)!.permissions)))).shown.map((x) => x.id);
    assert.deepEqual(ids("mechanic"), ["today-appointments", "time-stamp", "orders-open", "inspection-due"], "Mechaniker: Termine, Stempeln, offene Aufträge und Prüfungen");
    assert.deepEqual(ids("office"), ["today-appointments", "time-stamp", "orders-open", "invoices-open"], "Büro: Termine, Stempeln, offene Aufträge, Rechnungen");
  });

  it("Bausteine ausgeschalteter Funktionen fehlen, auch wenn das Recht in der Rolle steht (ausgeschaltet = keine Rechte)", () => {
    const permissions = new Set<string>(["appointments.view", "tires.view"]);
    const only = registry.widgetsFor(sessionOf(permissions, new Set(["workshop.appointments"])));
    assert.deepEqual(only.map((x) => x.id), ["today-appointments"]);
  });
});

