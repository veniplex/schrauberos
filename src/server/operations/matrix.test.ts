import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { ALL_PERMISSIONS, FEATURES, featureOfPermission } from "@/modules/catalog";
import { startupState } from "@/server/startup-state";
import { createTestEnv, form, NotFoundSignal, RedirectSignal, type TestEnv } from "@/test/harness";

/**
 * Berechtigungs-Matrix (generiert, P1a-5): Jede Server Action des Aktions-Rahmens und jeder Route Handler wird ohne Sitzung, mit
 * `mustChangePassword` und mit falschem Recht aufgerufen und muss ablehnen – ohne etwas zu verändern. Die Liste entsteht aus dem
 * Quelltext: Eine neue Aktion oder Route ist automatisch dabei, vergessene Prüfungen fallen sofort auf.
 */
const SRC = path.resolve(process.cwd(), "src");

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full, match) : match(name) ? [full] : [];
  });
}
const specOf = (file: string) => `@/${path.relative(SRC, file).split(path.sep).join("/").replace(/\.tsx?$/, "")}`;

type Action = ((...args: unknown[]) => Promise<unknown>) & { operation: { name: string; permission: string; allowPasswordChange: boolean } };
type Outcome = { redirect?: string; notFound?: boolean };

/** Ruft `fn` auf und liefert, wohin die Aktion ablenkt (Weiterleitung oder „nicht gefunden“) – oder nichts, wenn sie lief. */
async function outcomeOf(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirect: error.url };
    if (error instanceof NotFoundSignal) return { notFound: true };
    throw error;
  }
  return {};
}

let env: TestEnv;
const actions: Action[] = [];
let declared = 0;
let routes: Array<{ file: string; url: string; methods: Array<[string, (request: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>]> }> = [];
let seq = 0;

/** Neue Funktionen sind von Haus aus aus (`defaultEnabled: false`): Die Matrix schaltet sie ein, sonst hätte niemand ihre Rechte und jede Prüfung liefe in „nicht gefunden“. */
async function enableDefaultOff() {
  for (const f of FEATURES) {
    if ((f as { defaultEnabled?: boolean }).defaultEnabled !== false || ("required" in f && f.required)) continue;
    const key = `${f.module}.${f.id}`;
    await env.db.featureSetting.upsert({ where: { key }, update: { enabled: true }, create: { key, enabled: true, updatedByName: "test" } });
  }
}

before(async () => {
  env = await createTestEnv();
  await enableDefaultOff();
  startupState().status = "ready"; // frisch gestartet ist der Zustand „starting“ (die Upload-Route sperrt dann mit 503)
  process.env.UPDATE_API_URL = "http://127.0.0.1:9"; // Update-Prüfung scheitert sofort, kein Netzwerk
  const actionFiles = walk(SRC, (n) => /\.tsx?$/.test(n) && !/\.test\./.test(n)).filter((f) => /\bdefineAction\(/.test(readFileSync(f, "utf8")) && !f.includes(`${path.sep}operations${path.sep}`));
  for (const file of actionFiles) {
    declared += [...readFileSync(file, "utf8").matchAll(/^export const \w+ = defineAction\(/gm)].length;
    const mod = (await import(specOf(file))) as Record<string, unknown>;
    for (const value of Object.values(mod)) if (typeof value === "function" && "operation" in value) actions.push(value as Action);
  }
  // alle Route Handler unter src/app, auch außerhalb von app/api (OpenAPI-Dokument der Verwaltung, Offline-Seite); Routengruppen wie „(app)“ gehören nicht zur Adresse
  const routeFiles = walk(path.join(SRC, "app"), (n) => n === "route.ts");
  routes = [];
  for (const file of routeFiles) {
    const mod = (await import(specOf(file))) as Record<string, unknown>;
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function").map((m) => [m, mod[m]] as never);
    const url = `/${path.relative(SRC, path.dirname(file)).split(path.sep).join("/").replace(/\[(?:\.\.\.)?\w+\]/g, "x").replace(/\(\w+\)\//g, "")}`;
    routes.push({ file: path.relative(SRC, file).split(path.sep).join("/"), url, methods });
  }
});
after(() => env.cleanup());

/** Meldet einen frischen Benutzer mit genau diesen Rechten an (oder als Administrator). */
async function signInAs(options: { permissions?: readonly string[]; admin?: boolean; mustChangePassword?: boolean }) {
  const role = await env.role({ key: `matrix-${++seq}`, isAdmin: options.admin, permissions: options.permissions ?? [] });
  env.signOut();
  await env.signIn(await env.user({ username: `matrix-${seq}`, mustChangePassword: options.mustChangePassword, roles: [role] }));
}

const snapshot = async () => ({
  audit: await env.db.auditLog.count(),
  outbox: await env.db.outboxEvent.count(),
  users: await env.db.user.count({ where: { username: { not: { startsWith: "matrix-" } } } }),
  customers: await env.db.customer.count(),
  invoices: await env.db.invoice.count(),
  vehicles: await env.db.vehicle.count(),
  features: await env.db.featureSetting.count(),
  settings: await env.db.appSetting.count(),
  appointments: await env.db.appointment.count(),
  bays: await env.db.bay.count(),
  tireSets: await env.db.tireSet.count(),
  employees: await env.db.employee.count(),
  absences: await env.db.absence.count(),
  fleetVehicles: await env.db.fleetVehicle.count(),
  netDevices: await env.db.netDevice.count(),
  docPages: await env.db.docPage.count(),
  recoveryCodes: await env.db.recoveryCode.count(),
});

describe("Berechtigungs-Matrix: Server Actions", () => {
  it("findet die umgestellten Aktionen (kein leerer Lauf)", () => {
    // Generiert: Jede im Quelltext mit `export const x = defineAction(` angelegte Aktion muss auch geladen und damit geprüft werden
    assert.ok(declared >= 70, `nur ${declared} Aktionen im Quelltext gefunden`);
    assert.equal(actions.length, declared, "alle angelegten Aktionen sind in der Matrix");
    const names = actions.map((a) => a.operation.name);
    assert.equal(new Set(names).size, names.length, "Operationsnamen sind eindeutig");
    for (const a of actions) assert.ok(a.operation.permission, `${a.operation.name}: permission fehlt`);
  });

  it("ohne Sitzung: Weiterleitung zur Anmeldung, nichts verändert", async () => {
    env.signOut();
    const before = await snapshot();
    for (const action of actions) {
      assert.deepEqual(await outcomeOf(() => action({}, form({}))), { redirect: "/login" }, `${action.operation.name} (Formularzustand)`);
      assert.deepEqual(await outcomeOf(() => action(form({}))), { redirect: "/login" }, `${action.operation.name} (<form action>)`);
    }
    assert.deepEqual(await snapshot(), before);
  });

  it("mit mustChangePassword (auch als Administrator): Weiterleitung zum Konto, nichts verändert", async () => {
    await signInAs({ admin: true, mustChangePassword: true });
    const before = await snapshot();
    for (const action of actions) {
      // Nur das Konto selbst (Profil, Passwort, Notzugangs-Hinweise, Anzeigeeinstellungen) bleibt erreichbar – sonst ließe sich der Wechsel nicht ausführen
      const expected = action.operation.allowPasswordChange ? {} : { redirect: "/account" };
      assert.deepEqual(await outcomeOf(() => action({}, form({}))), expected, action.operation.name);
      assert.deepEqual(await outcomeOf(() => action(form({}))), expected, action.operation.name);
    }
    assert.deepEqual(await snapshot(), before);
  });

  it("Pflicht-2FA ohne eingerichteten zweiten Faktor (auch als Administrator): nur die Konto-Aktionen sind erreichbar, alles andere leitet zum Konto – nichts verändert", async () => {
    await env.db.appSetting.create({ data: { key: "auth.require2faAdmins", value: "true" } });
    try {
      await signInAs({ admin: true });
      const before = await snapshot();
      for (const action of actions) {
        const expected = action.operation.allowPasswordChange ? {} : { redirect: "/account" };
        assert.deepEqual(await outcomeOf(() => action({}, form({}))), expected, action.operation.name);
        assert.deepEqual(await outcomeOf(() => action(form({}))), expected, action.operation.name);
      }
      assert.deepEqual(await snapshot(), before);
      // Die Einrichtung selbst darf die Pflicht nie aussperren (ZP5-1)
      const reachable = new Set(actions.filter((a) => a.operation.allowPasswordChange).map((a) => a.operation.name));
      for (const name of ["account.startTwoFactor", "account.enableTwoFactor", "account.changePassword"]) assert.ok(reachable.has(name), name);
    } finally {
      await env.db.appSetting.deleteMany({ where: { key: "auth.require2faAdmins" } });
    }
  });

  it("nur Konto-Operationen erlauben den ausstehenden Passwortwechsel – und nur mit „authenticated“", () => {
    for (const action of actions) {
      if (action.operation.allowPasswordChange) {
        assert.equal(action.operation.permission, "authenticated", action.operation.name);
        assert.match(action.operation.name, /^(account|preferences)\./, `${action.operation.name}: allowPasswordChange nur für Konto/Anzeigeeinstellungen`);
      }
    }
  });

  it("mit falschem Recht (alle Rechte außer dem erforderlichen): /forbidden, nichts verändert", async () => {
    const before = await snapshot();
    for (const action of actions) {
      const { permission, name } = action.operation;
      if (permission === "authenticated") continue; // jede angemeldete Person darf
      await signInAs({ permissions: ALL_PERMISSIONS.filter((p) => p !== permission) });
      assert.deepEqual(await outcomeOf(() => action({}, form({}))), { redirect: "/forbidden" }, name);
      assert.deepEqual(await outcomeOf(() => action(form({}))), { redirect: "/forbidden" }, name);
    }
    await signInAs({ permissions: [] });
    for (const action of actions) {
      if (action.operation.permission === "authenticated") continue;
      assert.deepEqual(await outcomeOf(() => action({}, form({}))), { redirect: "/forbidden" }, `${action.operation.name} (ohne jedes Recht)`);
    }
    assert.deepEqual(await snapshot(), before);
  });

  it("Gegenprobe: mit genau dem erforderlichen Recht wird nicht an der Anmeldung/Berechtigung abgewiesen", async () => {
    // „Überall abmelden“ gelingt und führt absichtlich zur Anmeldung (die Sitzung ist danach weg) – das ist keine Abweisung
    const leavesSession = new Set(["account.logoutEverywhere"]);
    for (const action of actions) {
      const { permission, name } = action.operation;
      if (leavesSession.has(name)) continue;
      await signInAs({ permissions: permission === "authenticated" ? [] : [permission] });
      const out = await outcomeOf(() => action({}, form({})));
      assert.ok(!out.notFound && !["/login", "/account", "/forbidden"].includes(out.redirect ?? ""), `${name}: fälschlich abgewiesen (${JSON.stringify(out)})`);
    }
  });

  it("ausgeschaltete Funktion: die Aktion gibt es nicht (404), auch mit dem Recht", async () => {
    let tested = 0;
    for (const action of actions) {
      const { permission, name } = action.operation;
      if (permission === "authenticated") continue;
      const featureId = featureOfPermission(permission);
      const feature = FEATURES.find((f) => `${f.module}.${f.id}` === featureId);
      if (!feature || ("required" in feature && feature.required)) continue; // Verwaltung ist Plattform und nie abschaltbar
      await env.db.featureSetting.upsert({ where: { key: featureId! }, update: { enabled: false }, create: { key: featureId!, enabled: false } });
      await signInAs({ admin: true });
      assert.deepEqual(await outcomeOf(() => action({}, form({}))), { notFound: true }, name);
      await env.db.featureSetting.deleteMany();
      await enableDefaultOff();
      tested++;
    }
    assert.ok(tested > 5);
  });
});

describe("Berechtigungs-Matrix: Route Handler", () => {
  // Ohne Anmeldung erreichbar (Liveness für Docker/Launcher; das Logo für die Anmeldeseite); alles andere verlangt Sitzung und Recht
  // Wiederherstellung in der Einrichtung: eigene Prüfung (Einrichtungs-Token, nur ohne Benutzer) – siehe der Test darunter und `src/app/api/setup/restore/route.test.ts`
  const PUBLIC = new Set(["app/api/health/route.ts", "app/api/setup/restore/route.ts", "app/api/logo/route.ts", "app/offline/route.ts"]);
  // Programmierschnittstelle: authentifiziert nur über Bearer-Token und ignoriert das Sitzungs-Cookie vollständig (eigene Matrix: server/api/matrix.test.ts)
  // Kalender-Abo: nur das Token in der Adresse zählt, kein Cookie (Lebenszyklus, 401-Gleichheit, Rechte: appointments/feed.test.ts)
  const TOKEN_ONLY = new Set(["app/api/v1/[...path]/route.ts", "app/api/ical/[file]/route.ts"]);
  const call = (route: (typeof routes)[number], method: string, handler: (typeof routes)[number]["methods"][number][1]) =>
    // Header der Upload-Routen gegen Fremdaufrufe (`isSameOriginUpload`): gesetzt, damit die Probe das **Recht** prüft und nicht an der Herkunftsprüfung scheitert
    handler(new NextRequest(`http://localhost${route.url}`, { method, headers: { "x-requested-with": "schrauberos" } }), { params: Promise.resolve({ id: "x", name: "x", file: "x" }) });

  it("findet die Route Handler (kein leerer Lauf)", () => {
    assert.ok(routes.length >= 8, `nur ${routes.length} Routen gefunden`);
    assert.ok(routes.some((r) => PUBLIC.has(r.file)));
  });

  it("ohne Sitzung und mit mustChangePassword: 401", async () => {
    for (const mode of ["none", "mustChange"] as const) {
      if (mode === "none") env.signOut();
      else await signInAs({ admin: true, mustChangePassword: true });
      for (const route of routes) {
        if (PUBLIC.has(route.file)) continue;
        for (const [method, handler] of route.methods) assert.equal((await call(route, method, handler)).status, 401, `${method} ${route.url} (${mode})`);
      }
    }
  });

  it("die Wiederherstellung der Einrichtung antwortet nach der Einrichtung (es gibt Benutzer) mit 409 und ändert nichts", async () => {
    env.signOut();
    const route = routes.find((r) => r.file === "app/api/setup/restore/route.ts");
    assert.ok(route, "Route nicht gefunden");
    const before = await snapshot();
    for (const [method, handler] of route.methods) assert.equal((await call(route, method, handler)).status, 409, `${method} ${route.url}`);
    assert.deepEqual(await snapshot(), before);
  });

  it("die Programmierschnittstelle und das Kalender-Abo lassen sich mit einer Cookie-Sitzung nicht benutzen (auch nicht als Administrator): 401", async () => {
    await signInAs({ admin: true });
    const tokenRoutes = routes.filter((r) => TOKEN_ONLY.has(r.file));
    assert.equal(tokenRoutes.length, TOKEN_ONLY.size, "Token-Routen nicht gefunden");
    for (const route of tokenRoutes) for (const [method, handler] of route.methods) assert.equal((await call(route, method, handler)).status, 401, `${method} ${route.url}`);
  });

  it("mit falschem Recht (ohne jedes Recht): abgelehnt, nie 2xx", async () => {
    await signInAs({ permissions: [] });
    for (const route of routes) {
      if (PUBLIC.has(route.file) || TOKEN_ONLY.has(route.file)) continue;
      for (const [method, handler] of route.methods) {
        const status = (await call(route, method, handler)).status;
        assert.ok(status >= 400 && status < 500 && status !== 401, `${method} ${route.url}: erwartet 4xx (Recht fehlt), war ${status}`);
      }
    }
  });

  /**
   * Das Recht je Route (Z6-1 L4): `all` = jedes dieser Rechte ist nötig, `any` = eines genügt. Die Tabelle ist die **unabhängige** Gegenprobe zum Quelltext der Route: Wer das falsche Recht prüft (etwa
   * `customers.view` statt `billing.view`), fällt hier auf, weil die Probe alle Rechte *außer* dem erforderlichen vergibt und genau 403 verlangt. Eine neue Route muss hier (oder in `SPECIAL`) eingetragen werden.
   */
  const NEEDS: Record<string, { all?: string[]; any?: string[]; /** Funktion, deren Abschalten die Route sperrt (Standard: die des ersten Rechts) */ feature?: string }> = {
    "app/(app)/(admin)/admin/api/openapi.json/route.ts": { all: ["api.manage"] },
    "app/api/appointments/[id]/slip/route.ts": { all: ["appointments.view"] },
    "app/api/appointments/hints/route.ts": { any: ["appointments.create", "appointments.edit"] },
    "app/api/backups/[name]/route.ts": { all: ["backup.manage"] },
    "app/api/backups/status/route.ts": { all: ["backup.manage"] },
    "app/api/billing/[id]/pdf/route.ts": { all: ["billing.view"] },
    "app/api/billing/[id]/xml/route.ts": { all: ["billing.view"] },
    "app/api/billing/deductions/route.ts": { all: ["billing.edit"] },
    "app/api/checklists/[id]/signature/route.ts": { all: ["checklists.view"] },
    "app/api/customers/[id]/disclosure/route.ts": { all: ["customers.disclose", "customers.view"] },
    "app/api/customers/search/route.ts": { any: ["customers.view", "customers.edit", "invoices.edit", "billing.edit"], feature: "workshop.customers" },
    "app/api/employees/absence-hints/route.ts": { all: ["employees.edit"] },
    "app/api/files/[id]/route.ts": { all: ["files.view"] },
    "app/api/files/route.ts": { all: ["files.upload"] },
    "app/api/backups/upload/route.ts": { all: ["backup.manage"] },
    "app/api/docs/images/route.ts": { any: ["handbook.edit", "docsIt.edit"], feature: "" }, // zwei Funktionen: das Abschalten nur einer sperrt die Route nicht
    "app/api/invoices/[id]/file/route.ts": { all: ["invoices.view"] },
    "app/api/invoices/e-invoice/route.ts": { all: ["invoices.edit"] },
    "app/api/orders/[id]/card/route.ts": { all: ["orders.view"] },
    "app/api/orders/approvals/[id]/signature/route.ts": { all: ["orders.view", "orders.prices"] },
    "app/api/parts/search/route.ts": { all: ["parts.view"] },
    "app/api/tires/[id]/label/route.ts": { all: ["tires.view"] },
    "app/api/updates/status/route.ts": { all: ["updates.manage"] },
    "app/api/vehicles/search/route.ts": { any: ["appointments.create", "appointments.edit", "tires.create", "tires.edit", "vehicles.view", "billing.edit"], feature: "workshop.vehicles" },

  };
  /** Routen, deren Recht von Daten abhängt (Bereich des Bildes, Datenart, Suchanbieter): eigene Tests, hier nur die gemeinsamen Proben. */
  const SPECIAL = new Set([
    "app/api/docs/images/[id]/route.ts", // Bereich des Bildes (handbook/it) bestimmt das Leserecht
    "app/api/exchange/[kind]/route.ts", // Recht je Datenart (`<funktion>.export`)
    "app/api/exchange/[kind]/import/route.ts", // Recht je Datenart (`<funktion>.import`)
    "app/api/search/route.ts", // Rechte der Suchanbieter
  ]);

  it("jede Route ist eingeordnet: öffentlich, nur Token, mit festem Recht oder besonders (neue Routen müssen eingetragen werden)", () => {
    const unclassified = routes.filter((r) => !PUBLIC.has(r.file) && !TOKEN_ONLY.has(r.file) && !(r.file in NEEDS) && !SPECIAL.has(r.file)).map((r) => r.file);
    assert.deepEqual(unclassified, []);
    const stale = [...Object.keys(NEEDS), ...SPECIAL].filter((file) => !routes.some((r) => r.file === file));
    assert.deepEqual(stale, [], "Einträge ohne Route");
  });

  it("mit allen Rechten außer dem erforderlichen: genau 403 (nicht 404, nicht 2xx) – und mit dem Recht nicht 401/403", async () => {
    for (const route of routes) {
      const needs = NEEDS[route.file];
      if (!needs) continue;
      const required = needs.all ?? needs.any ?? [];
      // „all“: jedes Recht einzeln weglassen; „any“: alle weglassen
      const withheld = needs.all ? needs.all.map((p) => [p]) : [required];
      for (const missing of withheld) {
        await signInAs({ permissions: ALL_PERMISSIONS.filter((p) => !missing.includes(p)) });
        for (const [method, handler] of route.methods) assert.equal((await call(route, method, handler)).status, 403, `${method} ${route.url} ohne ${missing.join("+")}`);
      }
      // Gegenprobe: mit genau dem Recht wird nicht an der Berechtigung abgewiesen (404/400 für die erfundene Kennung sind in Ordnung)
      await signInAs({ permissions: needs.all ?? [required[0]!] });
      for (const [method, handler] of route.methods) {
        const status = (await call(route, method, handler)).status;
        assert.ok(status !== 401 && status !== 403, `${method} ${route.url}: mit dem erforderlichen Recht fälschlich abgewiesen (${status})`);
      }
    }
  });

  it("Pflicht-2FA ohne eingerichteten zweiten Faktor (auch als Administrator): 401 auf jeder geschützten Route", async () => {
    await env.db.appSetting.upsert({ where: { key: "auth.require2faAdmins" }, update: { value: "true" }, create: { key: "auth.require2faAdmins", value: "true" } });
    try {
      await signInAs({ admin: true });
      for (const route of routes) {
        if (PUBLIC.has(route.file) || TOKEN_ONLY.has(route.file)) continue;
        for (const [method, handler] of route.methods) assert.equal((await call(route, method, handler)).status, 401, `${method} ${route.url}`);
      }
    } finally {
      await env.db.appSetting.deleteMany({ where: { key: "auth.require2faAdmins" } });
    }
  });

  it("ausgeschaltete Funktion: die Route antwortet auch mit dem Recht (Administrator) mit 403 oder 404", async () => {
    let tested = 0;
    for (const route of routes) {
      const needs = NEEDS[route.file];
      if (!needs || needs.feature === "") continue;
      const featureId = needs.feature ?? featureOfPermission((needs.all ?? needs.any)![0]!);
      const feature = FEATURES.find((f) => `${f.module}.${f.id}` === featureId);
      if (!feature || ("required" in feature && feature.required)) continue; // Verwaltung ist Plattform und nie abschaltbar
      await env.db.featureSetting.upsert({ where: { key: featureId! }, update: { enabled: false }, create: { key: featureId!, enabled: false } });
      await signInAs({ admin: true });
      for (const [method, handler] of route.methods) {
        const status = (await call(route, method, handler)).status;
        assert.ok(status === 403 || status === 404, `${method} ${route.url} (${featureId} aus): erwartet 403/404, war ${status}`);
      }
      await env.db.featureSetting.deleteMany();
      await enableDefaultOff();
      tested++;
    }
    assert.ok(tested > 10, `nur ${tested} Routen geprüft`);
  });
});
