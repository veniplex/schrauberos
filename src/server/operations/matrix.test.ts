import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { ALL_PERMISSIONS, FEATURES, featureOfPermission } from "@/modules/catalog";
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

type Action = ((...args: unknown[]) => Promise<unknown>) & { operation: { name: string; permission: string } };
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
let actions: Action[] = [];
let routes: Array<{ file: string; url: string; methods: Array<[string, (request: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>]> }> = [];
let seq = 0;

before(async () => {
  env = await createTestEnv();
  process.env.UPDATE_API_URL = "http://127.0.0.1:9"; // Update-Prüfung scheitert sofort, kein Netzwerk
  const actionFiles = walk(SRC, (n) => /\.tsx?$/.test(n) && !/\.test\./.test(n)).filter((f) => /\bdefineAction\(/.test(readFileSync(f, "utf8")) && !f.includes(`${path.sep}operations${path.sep}`));
  for (const file of actionFiles) {
    const mod = (await import(specOf(file))) as Record<string, unknown>;
    for (const value of Object.values(mod)) if (typeof value === "function" && "operation" in value) actions.push(value as Action);
  }
  const routeFiles = walk(path.join(SRC, "app", "api"), (n) => n === "route.ts");
  routes = [];
  for (const file of routeFiles) {
    const mod = (await import(specOf(file))) as Record<string, unknown>;
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function").map((m) => [m, mod[m]] as never);
    const url = `/${path.relative(SRC, path.dirname(file)).split(path.sep).join("/").replace(/\[\w+\]/g, "x")}`;
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
});

describe("Berechtigungs-Matrix: Server Actions", () => {
  it("findet die umgestellten Aktionen (kein leerer Lauf)", () => {
    assert.ok(actions.length >= 20, `nur ${actions.length} Aktionen gefunden`);
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
      assert.deepEqual(await outcomeOf(() => action({}, form({}))), { redirect: "/account" }, action.operation.name);
      assert.deepEqual(await outcomeOf(() => action(form({}))), { redirect: "/account" }, action.operation.name);
    }
    assert.deepEqual(await snapshot(), before);
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
    for (const action of actions) {
      const { permission, name } = action.operation;
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
      tested++;
    }
    assert.ok(tested > 5);
  });
});

describe("Berechtigungs-Matrix: Route Handler", () => {
  // Ohne Anmeldung erreichbar (Liveness für Docker/Launcher); alles andere verlangt Sitzung und Recht
  const PUBLIC = new Set(["app/api/health/route.ts"]);
  const call = (route: (typeof routes)[number], method: string, handler: (typeof routes)[number]["methods"][number][1]) =>
    handler(new NextRequest(`http://localhost${route.url}`, { method }), { params: Promise.resolve({ id: "x", name: "x" }) });

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

  it("mit falschem Recht (ohne jedes Recht): abgelehnt, nie 2xx", async () => {
    await signInAs({ permissions: [] });
    for (const route of routes) {
      if (PUBLIC.has(route.file)) continue;
      for (const [method, handler] of route.methods) {
        const status = (await call(route, method, handler)).status;
        assert.ok(status >= 400 && status < 500 && status !== 401, `${method} ${route.url}: erwartet 4xx (Recht fehlt), war ${status}`);
      }
    }
  });
});
