import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Role, User } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { de } from "@/i18n/messages/de";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Rechte-Hierarchie bei Rollen (SEC-02, ARCH-02): Ein Nicht-Admin ändert Rollen nur um Rechte, die er selbst hat und die nicht
 * adminOnly sind (Differenzprüfung), nie die eigene Rolle, nie Administrator-Rollen und nie Rollen mit adminOnly-Rechten.
 */
/** Der Fehler muss eine Ablehnung der Rechte-Hierarchie sein – nicht irgendein anderer Fehler. */
const assertDenied = (state: { error?: string }) => assert.ok(Object.values(de.rbac.denied).includes(state.error ?? ""), `Ablehnung der Rechte-Hierarchie erwartet, war: ${state.error}`);

let env: TestEnv;
let actions: typeof import("./actions");

let adminRole: Role;
let editorRole: Role; // darf Rollen verwalten (bewusst von einem Admin vergeben)
let manager: User;
let admin2: User;

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  adminRole = await env.role({ key: "admin", isAdmin: true, isSystem: true });
  editorRole = await env.role({ key: "editor", permissions: ["roles.manage", "appointments.view", "appointments.edit", "tires.view"] });
  manager = await env.user({ username: "manager", roles: [editorRole] });
  admin2 = await env.user({ username: "admin2", roles: [adminRole] });
  await env.signIn(manager);
});

const permsOf = async (role: { id: string }) => (await env.db.rolePermission.findMany({ where: { roleId: role.id } })).map((p) => p.permission).sort();
const save = async (role: Role | null, values: { name?: string; permissions: string[]; version?: string }) => {
  const fresh = role ? await env.db.role.findUniqueOrThrow({ where: { id: role.id } }) : null;
  return actions.saveRole(
    {},
    form({ ...(fresh ? { id: fresh.id, version: values.version ?? versionOf(fresh) } : {}), name: values.name ?? fresh?.name ?? "Neue Rolle", permission: values.permissions }),
  );
};

describe("saveRole – Rechte-Hierarchie", () => {
  it("fügt keine Rechte hinzu, die der Aufrufer nicht hat", async () => {
    const target = await env.role({ permissions: ["appointments.view"] });
    assertDenied((await save(target, { permissions: ["appointments.view", "invoices.edit"] })));
    assert.deepEqual(await permsOf(target), ["appointments.view"]);
  });

  it("entfernt keine Rechte, die der Aufrufer nicht hat (Differenzprüfung)", async () => {
    const target = await env.role({ permissions: ["appointments.view", "invoices.edit"] });
    assertDenied((await save(target, { permissions: ["appointments.view"] })));
    assert.deepEqual(await permsOf(target), ["appointments.view", "invoices.edit"]);
  });

  it("lässt bestehende Rechte unverändert, die der Aufrufer nicht hat, und ändert nur die Differenz", async () => {
    const target = await env.role({ permissions: ["appointments.view", "invoices.edit"] });
    const result = await redirectOf(() => save(target, { permissions: ["appointments.view", "invoices.edit", "tires.view"] }));
    assert.match(result ?? "", /^\/admin\/roles$/);
    assert.deepEqual(await permsOf(target), ["appointments.view", "invoices.edit", "tires.view"]);
  });

  it("vergibt keine adminOnly-Rechte – auch nicht, wenn der Aufrufer sie selbst besitzt", async () => {
    const target = await env.role({ permissions: ["appointments.view"] });
    assertDenied((await save(target, { permissions: ["appointments.view", "roles.manage"] })));
    assert.deepEqual(await permsOf(target), ["appointments.view"]);
    assertDenied((await save(null, { name: "Neu", permissions: ["roles.manage"] })));
    assert.equal(await env.db.role.count({ where: { name: "Neu" } }), 0);
  });

  it("ändert keine Rolle mit adminOnly-Rechten", async () => {
    const power = await env.role({ key: "power", permissions: ["appointments.view", "users.manage"] });
    assertDenied((await save(power, { name: "Umbenannt", permissions: ["appointments.view", "users.manage"] })));
    assert.equal((await env.db.role.findUniqueOrThrow({ where: { id: power.id } })).name, power.name);
  });

  it("ändert die eigene Rolle nicht", async () => {
    assertDenied((await save(editorRole, { permissions: ["roles.manage", "appointments.view"] })));
    assert.deepEqual(await permsOf(editorRole), ["appointments.edit", "appointments.view", "roles.manage", "tires.view"]);
  });

  it("ändert die Administrator-Rolle nicht", async () => {
    assertDenied((await save(adminRole, { name: "Gehackt", permissions: [] })));
    assert.equal((await env.db.role.findUniqueOrThrow({ where: { id: adminRole.id } })).name, adminRole.name);
  });

  it("legt eine Rolle mit eigenen Rechten an (ohne adminOnly)", async () => {
    const result = await redirectOf(() => save(null, { name: "Hilfskraft", permissions: ["appointments.view", "tires.view"] }));
    assert.match(result ?? "", /^\/admin\/roles$/);
    const created = await env.db.role.findFirstOrThrow({ where: { name: "Hilfskraft" } });
    assert.deepEqual(await permsOf(created), ["appointments.view", "tires.view"]);
  });

  it("legt keine Rolle mit fremden Rechten an", async () => {
    assertDenied((await save(null, { name: "Zuviel", permissions: ["appointments.view", "invoices.delete"] })));
    assert.equal(await env.db.role.count({ where: { name: "Zuviel" } }), 0);
  });

  it("meldet einen Konflikt bei veralteter Version, ohne zu überschreiben", async () => {
    const target = await env.role({ permissions: ["appointments.view"] });
    const stale = versionOf(target);
    await env.db.role.update({ where: { id: target.id }, data: { description: "inzwischen geändert" } });
    const state = await save(target, { permissions: ["appointments.view", "tires.view"], version: stale });
    assert.match(state.error ?? "", /geändert/);
    assert.deepEqual(await permsOf(target), ["appointments.view"]);
  });

  it("ein Administrator darf weiterhin alles", async () => {
    await env.signIn(admin2);
    const target = await env.role({ permissions: ["appointments.view"] });
    const result = await redirectOf(() => save(target, { permissions: ["appointments.view", "users.manage", "invoices.edit"] }));
    assert.match(result ?? "", /^\/admin\/roles$/);
    assert.deepEqual(await permsOf(target), ["appointments.view", "invoices.edit", "users.manage"]);
  });

  it("Rechte einer ausgeschalteten Funktion zählen als Rohrechte: ohne eigenes Recht kein Hinzufügen", async () => {
    await env.db.featureSetting.create({ data: { key: "office.invoices", enabled: false, updatedByName: "test" } });
    const target = await env.role({ permissions: ["appointments.view"] });
    assertDenied((await save(target, { permissions: ["appointments.view", "invoices.view"] })));
  });
});

describe("deleteRole – Rechte-Hierarchie", () => {
  it("löscht keine Rolle mit fremden oder adminOnly-Rechten, nicht die eigene und nicht die Administrator-Rolle", async () => {
    const foreign = await env.role({ permissions: ["invoices.delete"] });
    const adminOnly = await env.role({ permissions: ["users.manage"] });
    for (const r of [foreign, adminOnly, editorRole, adminRole]) await redirectOf(() => actions.deleteRole(form({ id: r.id })));
    assert.equal(await env.db.role.count({ where: { id: { in: [foreign.id, adminOnly.id, editorRole.id, adminRole.id] } } }), 4);
  });

  it("löscht eine Rolle mit Rechten, die der Aufrufer selbst hat", async () => {
    const ok = await env.role({ permissions: ["appointments.view"] });
    await redirectOf(() => actions.deleteRole(form({ id: ok.id })));
    assert.equal(await env.db.role.count({ where: { id: ok.id } }), 0);
  });
});

describe("Rolle duplizieren (/admin/roles/new?from=…)", () => {
  type Initial = { name: string; description: string; isAdmin: boolean; permissions: string[] };
  /** Rendert die Seite nicht, sondern liest die Vorbelegung, die sie dem Formular übergibt. */
  const initialOf = async (from: string): Promise<Initial> => {
    const { default: NewRolePage } = await import("@/app/(app)/(admin)/admin/roles/new/page");
    const element = (await NewRolePage({ searchParams: Promise.resolve({ from }) })) as { props: { children: Array<{ props: { initial?: Initial } }> } };
    const form = element.props.children.find((c) => c?.props?.initial);
    assert.ok(form, "das Formular erhält eine Vorbelegung");
    return form.props.initial!;
  };

  it("übernimmt Namen („Kopie von …“), Beschreibung und die Rechte, die der Aufrufer vergeben darf", async () => {
    const source = await env.role({ name: "Vorlage", permissions: ["appointments.view", "appointments.edit"] });
    await env.db.role.update({ where: { id: source.id }, data: { description: "für Annahme" } });
    const initial = await initialOf(source.id);
    assert.match(initial.name, /Vorlage/);
    assert.notEqual(initial.name, "Vorlage");
    assert.equal(initial.description, "für Annahme");
    assert.deepEqual([...initial.permissions].sort(), ["appointments.edit", "appointments.view"]);
  });

  it("lässt Rechte weg, die der Aufrufer selbst nicht vergeben darf (nicht besessen oder adminOnly)", async () => {
    const source = await env.role({ name: "Mächtig", permissions: ["appointments.view", "invoices.edit", "users.manage"] });
    const initial = await initialOf(source.id);
    assert.deepEqual(initial.permissions, ["appointments.view"]);
  });

  it("die Kopie einer Administrator-Rolle enthält für Nicht-Admins keine Verwaltungsrechte, für Administratoren alle Rechte", async () => {
    const asManager = await initialOf(adminRole.id);
    assert.ok(asManager.permissions.every((p) => ["appointments.view", "appointments.edit", "tires.view"].includes(p)), asManager.permissions.join());
    assert.ok(!asManager.permissions.includes("users.manage"));
    await env.signIn(admin2);
    const asAdmin = await initialOf(adminRole.id);
    assert.ok(asAdmin.permissions.includes("users.manage") && asAdmin.permissions.includes("appointments.view"));
  });

  it("ohne Recht roles.manage ist die Seite gesperrt", async () => {
    const plain = await env.user({ username: "plain", roles: [await env.role({ permissions: ["appointments.view"] })] });
    await env.signIn(plain);
    const { default: NewRolePage } = await import("@/app/(app)/(admin)/admin/roles/new/page");
    assert.equal(await redirectOf(() => NewRolePage({ searchParams: Promise.resolve({}) })), "/forbidden");
  });
});

describe("saveRole – gleichzeitiges Bearbeiten", () => {
  it("drei gleichzeitige Speicherungen derselben Version: genau eine gewinnt, die anderen melden den Konflikt", async () => {
    const target = await env.role({ name: "Gemeinsam", permissions: ["appointments.view"] });
    const version = versionOf(await env.db.role.findUniqueOrThrow({ where: { id: target.id } }));
    const submit = (name: string) => actions.saveRole({}, form({ id: target.id, version, name, permission: ["appointments.view"] }));
    const results = await Promise.allSettled([submit("Name A"), submit("Name B"), submit("Name C")]);
    const redirected = results.filter((r) => r.status === "rejected" && /NEXT_REDIRECT/.test(String(r.reason)));
    const conflicts = results.filter((r) => r.status === "fulfilled" && r.value.error === de.common.conflict);
    assert.equal(redirected.length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(conflicts.length, 2);
    assert.match((await env.db.role.findUniqueOrThrow({ where: { id: target.id } })).name, /^Name [ABC]$/);
  });
});
