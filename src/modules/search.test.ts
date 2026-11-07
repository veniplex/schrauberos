import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Schnellsuche und „Neu“-Menü: Die Funktionen liefern Suchanbieter (`search.ts`) und `quickActions` (`feature.ts`); die Plattform aggregiert nur (Route `/api/search`,
 * `registry.ts`). Dieser Test sichert den Vertrag (jede fachliche Funktion hat einen Anbieter, Rechte gehören zur Funktion, Texte vorhanden), die Trennung (die Plattform
 * importiert keine Funktion) und das Verhalten (Rechte-/Aktivierungsfilter, Sichtbarkeit der Dokumentation) gegen eine echte Datenbank.
 */
let env: TestEnv;
let route: typeof import("@/app/api/search/route");
let registry: typeof import("./registry");
let catalog: typeof import("./catalog");

before(async () => {
  env = await createTestEnv();
  route = await import("@/app/api/search/route");
  registry = await import("./registry");
  catalog = await import("./catalog");
});
after(() => env.cleanup());

describe("Vertrag", () => {
  it("jede fachliche (abschaltbare) Funktion bringt einen Suchanbieter mit – Plattform und Verwaltung nicht", () => {
    const providers = new Set(registry.ALL_SEARCH_PROVIDERS.map((p) => p.feature));
    const missing = catalog.FEATURES.filter((f) => !("required" in f && f.required) && !providers.has(catalog.fullFeatureId(f))).map((f) => catalog.fullFeatureId(f));
    assert.deepEqual(missing, [], "diese Funktionen brauchen eine search.ts (Definition of Done jeder Funktion)");
    const platform = registry.ALL_SEARCH_PROVIDERS.filter((p) => catalog.FEATURES.some((f) => "required" in f && f.required && catalog.fullFeatureId(f) === p.feature));
    assert.deepEqual(platform, [], "Verwaltungsfunktionen sind nie durchsuchbar");
  });

  it("Anbieter: eindeutige Ids, das Recht gehört zur Funktion, die Gruppenüberschrift ist in DE und EN übersetzt", async () => {
    const { de } = await import("@/i18n/messages/de");
    const { en } = await import("@/i18n/messages/en");
    const has = (messages: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), messages) !== undefined;
    const ids = registry.ALL_SEARCH_PROVIDERS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of registry.ALL_SEARCH_PROVIDERS) {
      assert.equal(catalog.featureOfPermission(p.permission), p.feature, `${p.id}: Recht ${p.permission} gehört nicht zu ${p.feature}`);
      assert.ok(has(de, p.groupKey) && has(en, p.groupKey), `${p.id}: Gruppenüberschrift ${p.groupKey} fehlt`);
    }
  });

  it("quickActions: Recht gehört zur Funktion, Beschriftung in DE und EN, Ziel ist ein interner Pfad", async () => {
    const { de } = await import("@/i18n/messages/de");
    const { en } = await import("@/i18n/messages/en");
    const has = (messages: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), messages) !== undefined;
    let count = 0;
    for (const feature of catalog.FEATURES) {
      for (const action of (feature as { quickActions?: readonly { id: string; labelKey: string; href: string; permission: string }[] }).quickActions ?? []) {
        count++;
        assert.ok((feature.permissions.keys as readonly string[]).includes(action.permission), `${action.id}: Recht ${action.permission} gehört nicht zur Funktion`);
        assert.ok(has(de, action.labelKey) && has(en, action.labelKey), `${action.id}: Beschriftung fehlt`);
        assert.ok(action.href.startsWith("/") && !action.href.startsWith("//"), `${action.id}: Ziel ${action.href}`);
      }
    }
    assert.ok(count >= 8, `nur ${count} Einträge im Neu-Menü`);
  });

  it("die Plattform kennt keine Funktion: Route und Schnellsuche importieren nur die Registry", () => {
    const SRC = path.resolve(process.cwd(), "src");
    for (const file of ["app/api/search/route.ts", "components/shell/quick-search.tsx", "components/shell/new-menu.tsx", "components/shell/sidebar.tsx", "app/app-shell.tsx"]) {
      const imports = [...readFileSync(path.join(SRC, file), "utf8").matchAll(/from "@\/modules\/([^"]+)"/g)].map((m) => m[1]);
      for (const target of imports) assert.ok(["registry", "catalog", "define", "types"].includes(target), `${file} importiert @/modules/${target} (nur Registry/Katalog/Typen erlaubt)`);
    }
  });
});

describe("Verhalten", () => {
  const as = async (permissions: string[], extra: { roleIds?: string[] } = {}) => {
    const role = await env.role({ permissions });
    await env.signIn(await env.user({ username: `u${Math.random()}`, roles: [role, ...(extra.roleIds ?? [])].map((r) => (typeof r === "string" ? { id: r } : r)) as never }));
    return role;
  };
  const get = async (q: string) => {
    const response = await route.GET({ nextUrl: new URL(`http://localhost/api/search?q=${encodeURIComponent(q)}`) } as never);
    return { status: response.status, body: (await response.json()) as { groups: Array<{ id: string; label: string; hits: Array<{ title: string; subtitle?: string; href: string }> }> } };
  };

  beforeEach(async () => {
    await env.db.docPage.deleteMany();
    await env.db.docCategory.deleteMany();
    await env.db.invoice.deleteMany();
    await env.db.vehicle.deleteMany();
    await env.db.customer.deleteMany();
    await env.db.featureSetting.deleteMany();
    await env.db.session.deleteMany();
    await env.db.user.deleteMany();
    await env.db.role.deleteMany();
    env.signOut();
    const customer = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Suchtest", city: "Berlin", customerNumber: "K-9" } });
    await env.db.vehicle.create({ data: { plate: "B XY 999", plateNorm: "BXY999", make: "Suchtest-Auto", customerId: customer.id } });
    await env.db.invoice.create({ data: { direction: "incoming", number: "RE-Suchtest-1", partyName: "Lieferant", issueDate: new Date(), grossCents: 100 } });
  });

  it("ohne Sitzung 401, ohne ein einziges durchsuchbares Recht 403, zu kurzer Begriff liefert nichts", async () => {
    env.signOut();
    assert.equal((await get("Suchtest")).status, 401);
    await as([]);
    assert.equal((await get("Suchtest")).status, 403);
    await as(["customers.view"]);
    assert.deepEqual((await get("S")).body.groups, []);
  });

  it("liefert nur Gruppen, für die die Person das Recht hat, mit Treffern und Ziel", async () => {
    await as(["customers.view", "invoices.view"]);
    const { status, body } = await get("Suchtest");
    assert.equal(status, 200);
    assert.deepEqual(body.groups.map((g) => g.id).sort(), ["customers", "invoices"]);
    const customers = body.groups.find((g) => g.id === "customers")!;
    assert.equal(customers.label, "Kunden");
    assert.match(customers.hits[0].href, /^\/customers\/.+/);
    assert.equal(JSON.stringify(body).includes("BXY"), false, "Fahrzeuge ohne vehicles.view nicht");
  });

  it("eine ausgeschaltete Funktion liefert keine Treffer (Daten bleiben)", async () => {
    await as(["customers.view", "invoices.view"]);
    const before = (await get("Suchtest")).body.groups.map((g) => g.id);
    assert.ok(before.includes("invoices"));
    await env.db.featureSetting.create({ data: { key: "office.invoices", enabled: false } });
    const after = (await get("Suchtest")).body.groups.map((g) => g.id);
    assert.ok(!after.includes("invoices"));
    assert.ok(after.includes("customers"));
  });

  it("Dokumentation: Seiten aus Kapiteln, die die Rolle nicht lesen darf, tauchen nicht auf", async () => {
    const secretRole = await env.role({ permissions: [] });
    const chapter = await env.db.docCategory.create({ data: { area: "handbook", name: "Vertraulich", roles: { create: [{ roleId: secretRole.id }] } } });
    await env.db.docPage.create({ data: { area: "handbook", slug: "offen", title: "Offene Suchtest-Seite", content: "x" } });
    await env.db.docPage.create({ data: { area: "handbook", slug: "geheim", title: "Geheime Suchtest-Seite", content: "x", categoryId: chapter.id } });

    await as(["handbook.view"]);
    let hits = (await get("Suchtest")).body.groups.find((g) => g.id === "handbook")?.hits.map((h) => h.title) ?? [];
    assert.deepEqual(hits, ["Offene Suchtest-Seite"]);

    // mit der Rolle des Kapitels ist die Seite sichtbar
    await as(["handbook.view"], { roleIds: [secretRole.id] });
    hits = (await get("Suchtest")).body.groups.find((g) => g.id === "handbook")?.hits.map((h) => h.title).sort() ?? [];
    assert.deepEqual(hits, ["Geheime Suchtest-Seite", "Offene Suchtest-Seite"]);
  });

  it("das Neu-Menü bietet nur Einträge aktiver Funktionen mit passendem Recht", async () => {
    await as(["customers.edit", "vehicles.view"]);
    const { getSession } = await import("@/server/auth/session");
    const session = (await getSession())!;
    assert.deepEqual(registry.quickActionsFor(session).map((a) => a.id), ["customers.new"]);
  });
});
