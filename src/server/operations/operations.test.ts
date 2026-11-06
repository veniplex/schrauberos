import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { z } from "zod";
import type { AppSession } from "@/server/auth/session";
import { createTestEnv, form, isNotFound, NotFoundSignal, RedirectSignal, redirectOf, type TestEnv } from "@/test/harness";

let env: TestEnv;
let ops: typeof import("./index");
let hooks: typeof import("./hooks");
let flash: typeof import("./flash");
let session: () => Promise<AppSession>;
let admin: AppSession;
let nobody: AppSession;

before(async () => {
  env = await createTestEnv();
  ops = await import("./index");
  hooks = await import("./hooks");
  flash = await import("./flash");
  const { getSession } = await import("@/server/auth/session");
  session = async () => (await getSession())!;
  const adminRole = await env.role({ key: "admin", isAdmin: true, isSystem: true });
  const emptyRole = await env.role({ key: "empty" });
  const a = await env.user({ username: "chef", roles: [adminRole] });
  const n = await env.user({ username: "nobody", roles: [emptyRole] });
  await env.signIn(a);
  admin = await session();
  env.signOut();
  await env.signIn(n);
  nobody = await session();
  env.signOut();
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.auditLog.deleteMany();
  await env.db.outboxEvent.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
  hooks.setOperationHooksForTest(null);
  env.browser.writes.length = 0;
});

const nameSchema = z.object({ name: z.string().trim().min(1).max(10) });

describe("defineOperation – Rahmen", () => {
  it("verlangt eine Berechtigung und für audit: false eine Begründung", () => {
    assert.throws(() => ops.defineOperation({ name: "t.noPerm", permission: undefined as never, input: nameSchema, audit: "user.create", run: async () => null }), /permission/);
    assert.throws(() => ops.defineOperation({ name: "t.noReason", permission: "customers.edit", input: nameSchema, audit: false, auditReason: " ", run: async () => null }), /Begründung/);
  });

  it("lehnt ohne Recht ab, ohne etwas auszuführen", async () => {
    let ran = false;
    const op = ops.defineOperation({ name: "t.guard", permission: "customers.edit", input: nameSchema, audit: "customer.delete", run: async () => void (ran = true) });
    const outcome = await op.execute(nobody, { name: "x" });
    assert.deepEqual(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.failure.code, "forbidden");
    assert.equal(ran, false);
  });

  it("meldet ungültige Eingabe als Feldfehler mit Meldungsschlüsseln", async () => {
    const op = ops.defineOperation({ name: "t.fields", permission: "customers.edit", input: nameSchema, audit: false, auditReason: "Test", run: async () => null });
    const missing = await op.execute(admin, {});
    assert.ok(!missing.ok && missing.failure.code === "invalid" && missing.failure.fields?.name?.key === "validation.required");
    const tooLong = await op.execute(admin, { name: "x".repeat(11) });
    assert.ok(!tooLong.ok && tooLong.failure.fields?.name?.key === "validation.tooLong");
  });

  it("übernimmt eigene Prüfungen mit Schlüssel und Platzhaltern", async () => {
    const schema = z.object({ pw: z.string().superRefine((v, ctx) => {
      if (v.length < 8) ctx.addIssue({ code: "custom", message: "account.errors.passwordShort", params: { min: 8 } });
    }) });
    const op = ops.defineOperation({ name: "t.custom", permission: "customers.edit", input: schema, audit: false, auditReason: "Test", run: async () => null });
    const outcome = await op.execute(admin, { pw: "kurz" });
    assert.ok(!outcome.ok && outcome.failure.fields?.pw?.key === "account.errors.passwordShort" && outcome.failure.fields.pw.params?.min === 8);
  });

  it("schreibt Änderung und Audit-Eintrag in einer Transaktion", async () => {
    const op = ops.defineOperation({
      name: "t.create",
      permission: "customers.edit",
      input: nameSchema,
      audit: "customer.delete",
      run: async (ctx) => {
        const c = await ctx.tx.customer.create({ data: { lastName: ctx.input.name } });
        ctx.audit({ target: "Zeile\nzwei", entityId: c.id });
        return c.id;
      },
    });
    const outcome = await op.execute(admin, { name: " Müller " });
    assert.ok(outcome.ok);
    const entries = await env.db.auditLog.findMany();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actorName, "chef");
    assert.equal(entries[0].target, "Zeile zwei", "Steuerzeichen sind entfernt");
    assert.equal(entries[0].entityId, outcome.ok ? outcome.data : "");
  });

  it("rollt bei einem Fehler alles zurück (keine Änderung, kein Audit, kein Ereignis)", async () => {
    const op = ops.defineOperation({
      name: "t.rollback",
      permission: "customers.edit",
      input: nameSchema,
      audit: "customer.delete",
      run: async (ctx) => {
        await ctx.tx.customer.create({ data: { lastName: "A" } });
        await ctx.emit("customer.created", { x: 1 });
        ops.fail("conflict");
      },
    });
    const outcome = await op.execute(admin, { name: "A" });
    assert.ok(!outcome.ok && outcome.failure.code === "conflict");
    assert.equal(await env.db.customer.count(), 0);
    assert.equal(await env.db.auditLog.count(), 0);
    assert.equal(await env.db.outboxEvent.count(), 0);
  });

  it("schreibt Ereignisse in die Outbox – in derselben Transaktion", async () => {
    const op = ops.defineOperation({
      name: "t.emit",
      permission: "customers.edit",
      input: nameSchema,
      audit: false,
      auditReason: "Test",
      run: async (ctx) => {
        const c = await ctx.tx.customer.create({ data: { lastName: ctx.input.name } });
        await ctx.emit("customer.created", { name: ctx.input.name }, c.id);
        return c.id;
      },
    });
    const outcome = await op.execute(admin, { name: "Emil" });
    assert.ok(outcome.ok);
    const events = await env.db.outboxEvent.findMany();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "customer.created");
    assert.equal(events[0].entityId, outcome.ok ? outcome.data : "");
    assert.deepEqual(JSON.parse(events[0].payload), { name: "Emil" });
    assert.equal(events[0].processedAt, null);
    assert.equal(events[0].actorId, admin.user.id);
  });

  it("macht aus Datenbankfehlern P2002 / P2025 / P2003 fachliche Fehler", async () => {
    const dup = ops.defineOperation({
      name: "t.dup",
      permission: "customers.edit",
      input: nameSchema,
      audit: false,
      auditReason: "Test",
      run: async (ctx) => void (await ctx.tx.role.create({ data: { key: "admin", name: ctx.input.name } })),
    });
    assert.equal((await dup.execute(admin, { name: "R" })).ok, false);
    const missing = ops.defineOperation({
      name: "t.missing",
      permission: "customers.edit",
      input: nameSchema,
      audit: false,
      auditReason: "Test",
      run: async (ctx) => void (await ctx.tx.customer.update({ where: { id: "gibtsnicht" }, data: { lastName: ctx.input.name } })),
    });
    const c = await env.db.customer.create({ data: { lastName: "Halter" } });
    await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1", customerId: c.id } });
    const d = await dup.execute(admin, { name: "R" });
    const m = await missing.execute(admin, { name: "x" });
    const usedOp = ops.defineOperation({
      name: "t.used2",
      permission: "customers.edit",
      input: z.object({ id: z.string() }),
      audit: false,
      auditReason: "Test",
      run: async (ctx) => void (await ctx.tx.customer.delete({ where: { id: ctx.input.id } })),
    });
    const u = await usedOp.execute(admin, { id: c.id });
    assert.equal(!d.ok && d.failure.code, "duplicate");
    assert.equal(!m.ok && m.failure.code, "notFound");
    assert.equal(!u.ok && u.failure.code, "inUse");
  });

  it("lässt unerwartete Fehler durch (der Adapter protokolliert sie)", async () => {
    const op = ops.defineOperation({ name: "t.boom", permission: "customers.edit", input: nameSchema, audit: false, auditReason: "Test", run: async () => { throw new TypeError("kaputt"); } });
    await assert.rejects(() => op.execute(admin, { name: "x" }), TypeError);
  });

  it("führt afterCommit nur nach Erfolg aus und finish/onFailure nach Fehlern", async () => {
    const log: string[] = [];
    const op = ops.defineOperation({
      name: "t.life",
      permission: "customers.edit",
      input: z.object({ fail: z.boolean() }),
      audit: false,
      auditReason: "Test",
      prepare: async () => "vorab",
      run: async (ctx) => {
        ctx.afterCommit(() => void log.push(`commit:${ctx.prepared}`));
        if (ctx.input.fail) ops.fail("notFound");
      },
      finish: (prepared, ok) => void log.push(`finish:${prepared}:${ok}`),
      onFailure: ({ failure }) => void log.push(`failure:${failure?.code}`),
    });
    await op.execute(admin, { fail: true });
    assert.deepEqual(log, ["failure:notFound", "finish:vorab:false"]);
    log.length = 0;
    await op.execute(admin, { fail: false });
    assert.deepEqual(log, ["commit:vorab", "finish:vorab:true"]);
  });

  it("ruft Hooks anderer Funktionen in derselben Transaktion auf – ein Hook kann die Operation verhindern", async () => {
    const seen: string[] = [];
    hooks.setOperationHooksForTest([
      { operation: "t.hooked", feature: "workshop.customers", run: async ({ tx, result }) => void (await tx.customer.create({ data: { lastName: `Hook-${String(result)}` } })) },
      { operation: "t.hooked", feature: "office.fleet", run: () => void seen.push("fremde Funktion aus") },
      { operation: "t.other", feature: "workshop.customers", run: () => void seen.push("falsche Operation") },
    ]);
    const op = ops.defineOperation({ name: "t.hooked", permission: "customers.edit", input: z.object({ veto: z.boolean() }), audit: false, auditReason: "Test", run: async (ctx) => (ctx.input.veto ? "veto" : "ok") });
    const limited = { ...admin, features: new Set(["workshop.customers"]) } as AppSession;
    assert.ok((await op.execute(limited, { veto: false })).ok);
    assert.deepEqual((await env.db.customer.findMany()).map((c) => c.lastName), ["Hook-ok"]);
    assert.deepEqual(seen, [], "Hooks ausgeschalteter Funktionen und anderer Operationen laufen nicht");

    hooks.setOperationHooksForTest([{ operation: "t.hooked", feature: "workshop.customers", run: () => ops.fail("forbidden") }]);
    await env.db.customer.deleteMany();
    const vetoed = await op.execute(admin, { veto: true });
    assert.ok(!vetoed.ok && vetoed.failure.code === "forbidden");
  });
});

describe("defineAction – Server-Action-Adapter", () => {
  const op = ops_defaults();
  function ops_defaults() {
    return {
      save: () =>
        ops.defineOperation({
          name: "t.save",
          permission: "customers.edit",
          input: nameSchema.extend({ again: z.string().optional() }),
          audit: "customer.delete",
          run: async (ctx) => {
            if (ctx.input.name === "doppelt") ops.failField("name", "customers.errors.nameRequired");
            if (ctx.input.name === "weg") ops.fail("notFound");
            if (ctx.input.name === "nf") throw new NotFoundSignal();
            if (ctx.input.name === "rd") throw new RedirectSignal("/innen");
            if (ctx.input.name === "boom") throw new TypeError("geheimes Detail");
            const c = await ctx.tx.customer.create({ data: { lastName: ctx.input.name } });
            ctx.audit({ target: c.lastName, entityId: c.id });
            return { id: c.id };
          },
        }),
    };
  }

  it("leitet ohne Sitzung auf /login und mit mustChangePassword auf /account – ohne etwas auszuführen", async () => {
    const action = ops.defineAction(op.save());
    env.signOut();
    assert.equal(await redirectOf(() => action({}, form({ name: "A" }))), "/login");
    const role = await env.role({ key: "mcp", isAdmin: true });
    const u = await env.user({ username: "muss", mustChangePassword: true, roles: [role] });
    await env.signIn(u);
    assert.equal(await redirectOf(() => action({}, form({ name: "A" }))), "/account");
    env.signOut();
    assert.equal(await env.db.customer.count(), 0);
    await env.db.user.delete({ where: { id: u.id } });
  });

  it("antwortet im Formularzustand mit ok/Meldung, Feldfehlern und Fehlern (übersetzt)", async () => {
    const action = ops.defineAction(op.save(), { message: "common.saved" });
    await env.signIn(await env.db.user.findUniqueOrThrow({ where: { username: "chef" } }));
    assert.deepEqual(await action({}, form({ name: "Anna" })), { ok: true, message: "Gespeichert." });
    const fieldState = await action({}, form({}));
    assert.deepEqual(fieldState, { fieldErrors: { name: "Pflichtfeld." } });
    assert.ok((await action({}, form({ name: "doppelt" }))).fieldErrors?.name);
    assert.equal((await action({}, form({ name: "weg" }))).error, "Dieser Eintrag existiert nicht mehr.");
    assert.equal((await action({}, form({ name: "boom" }))).error, "Das hat nicht geklappt. Bitte versuche es noch einmal.");
    assert.equal(env.browser.writes.filter((w) => w.name === "so_flash").length, 0, "im Formularzustand kein Flash");
  });

  it("verschluckt redirect() und notFound() nie – weder aus run noch nach Erfolg", async () => {
    const action = ops.defineAction(op.save(), { redirect: (data) => `/customers/${data.id}` });
    await env.signIn(await env.db.user.findUniqueOrThrow({ where: { username: "chef" } }));
    assert.ok((await redirectOf(() => action({}, form({ name: "Berta" }))))?.startsWith("/customers/"));
    assert.equal(await redirectOf(() => action({}, form({ name: "rd" }))), "/innen");
    assert.equal(await isNotFound(() => action({}, form({ name: "nf" }))), true);
  });

  it("gibt Aktionen ohne Formularzustand (<form action>) Rückmeldung per Flash und bleibt auf der Seite", async () => {
    const action = ops.defineAction(op.save(), { message: "common.deleted", revalidate: ["/customers"] });
    await env.signIn(await env.db.user.findUniqueOrThrow({ where: { username: "chef" } }));
    assert.equal(await action(form({ name: "Clara" })), undefined);
    let written = env.browser.writes.filter((w) => w.name === "so_flash").at(-1)!;
    assert.deepEqual({ ...flash.decodeFlash(written.value) , id: "" }, { id: "", tone: "success", key: "common.deleted", params: undefined });
    assert.ok(env.browser.revalidated.includes("/customers"));
    assert.equal(await action(form({ name: "weg" })), undefined);
    written = env.browser.writes.filter((w) => w.name === "so_flash").at(-1)!;
    assert.equal(flash.decodeFlash(written.value)?.tone, "error");
    assert.equal(flash.decodeFlash(written.value)?.key, "common.errors.notFound");
  });

  it("leitet bei Fehlern nur auf Wunsch weiter (redirectOnError)", async () => {
    const action = ops.defineAction(op.save(), { redirectOnError: "/customers" });
    await env.signIn(await env.db.user.findUniqueOrThrow({ where: { username: "chef" } }));
    assert.equal(await redirectOf(() => action(form({ name: "weg" }))), "/customers");
  });

  it("Berechtigungsfehler (falsches Recht) leiten auf /forbidden", async () => {
    const action = ops.defineAction(op.save());
    env.signOut();
    await env.signIn(await env.db.user.findUniqueOrThrow({ where: { username: "nobody" } }));
    assert.equal(await redirectOf(() => action({}, form({ name: "A" }))), "/forbidden");
    assert.equal(await redirectOf(() => action(form({ name: "A" }))), "/forbidden");
    assert.equal(await env.db.customer.count(), 0);
  });

  it("trägt die Operation für die Berechtigungs-Matrix", () => {
    const o = op.save();
    assert.equal(ops.defineAction(o).operation, o);
    assert.equal(ops.listOperations().get("t.save")?.permission, "customers.edit");
  });
});

describe("Flash-Cookie", () => {
  it("enthält nur Schlüssel und einfache Platzhalter und verwirft Fremdes", () => {
    const value = flash.encodeFlash({ id: "abc", tone: "error", key: "rbac.denied.adminRole", params: { n: 3 } });
    assert.deepEqual(flash.decodeFlash(value), { id: "abc", tone: "error", key: "rbac.denied.adminRole", params: { n: 3 } });
    for (const bad of [undefined, "", "kein-base64!", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ id: "1", tone: "error", key: "<script>" })).toString("base64url"), Buffer.from(JSON.stringify({ id: "1", tone: "x", key: "a.b" })).toString("base64url")]) {
      assert.equal(flash.decodeFlash(bad), null);
    }
  });
});

describe("defineApi – Gerüst", () => {
  it("lehnt ohne Authentifizierer mit 401 ab und kennt das Fehlerformat", async () => {
    const op = ops.defineOperation({ name: "t.api", permission: "customers.edit", input: nameSchema, audit: false, auditReason: "Test", run: async (ctx) => ({ name: ctx.input.name }) });
    const handler = ops.defineApi(op, { status: 201 });
    const request = () => new Request("http://x/api/v1/t", { method: "POST", body: JSON.stringify({ name: "Api" }) });
    const none = await handler(request(), { params: Promise.resolve({}) });
    assert.equal(none.status, 401);
    assert.equal(((await none.json()) as { error: { code: string } }).error.code, "unauthenticated");

    ops.setApiAuthenticator(async (r) => (r.headers.get("authorization") === "Bearer ok" ? admin : null));
    try {
      const ok = await handler(new Request("http://x", { method: "POST", headers: { authorization: "Bearer ok" }, body: JSON.stringify({ name: "Api" }) }), { params: Promise.resolve({}) });
      assert.equal(ok.status, 201);
      assert.deepEqual(await ok.json(), { data: { name: "Api" } });
      const bad = await handler(new Request("http://x", { method: "POST", headers: { authorization: "Bearer ok" }, body: JSON.stringify({}) }), { params: Promise.resolve({}) });
      assert.equal(bad.status, 422);
      assert.equal(((await bad.json()) as { error: { fields: Record<string, { message: string }> } }).error.fields.name.message, "validation.required");
      const notJson = await handler(new Request("http://x", { method: "POST", headers: { authorization: "Bearer ok" }, body: "kein json" }), { params: Promise.resolve({}) });
      assert.equal(notJson.status, 400);
    } finally {
      ops.setApiAuthenticator(async () => null);
    }
  });
});
