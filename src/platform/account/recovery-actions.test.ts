import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Banner „Notzugang wurde verwendet“ als gesehen markieren (`acknowledgeNotice`, Z6-4 L-5): wirkt nur für die angemeldete Person selbst, nie für ein fremdes Konto, schreibt kein Audit
 * (das Ausblenden ändert keine Daten) und geht auch beim erzwungenen Passwortwechsel.
 */
let env: TestEnv;
let actions: typeof import("./recovery-actions");

before(async () => {
  env = await createTestEnv();
  actions = await import("./recovery-actions");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.recoveryNoticeAck.deleteMany();
  await env.db.recoveryNotice.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
});

const notice = (userId: string | null, userName = "x") => env.db.recoveryNotice.create({ data: { userId, userName } });
const acks = (noticeId: string) => env.db.recoveryNoticeAck.findMany({ where: { noticeId } });

describe("acknowledgeNotice", () => {
  it("die Person bestätigt den Hinweis zu ihrem eigenen Konto: genau eine Quittung, kein Audit, die Seiten werden neu geladen", async () => {
    const user = await env.user({ username: "anna", password: "passwort-12345" });
    await env.signIn(user);
    const n = await notice(user.id, "anna");
    await actions.acknowledgeNotice(form({ id: n.id }));
    assert.deepEqual((await acks(n.id)).map((a) => a.userId), [user.id]);
    await actions.acknowledgeNotice(form({ id: n.id }));
    assert.equal((await acks(n.id)).length, 1, "zweimal bestätigen ändert nichts (idempotent)");
    assert.equal(await env.db.auditLog.count(), 0);
    assert.ok(env.browser.revalidated.includes("/"));
  });

  it("ein Hinweis zu einem fremden Konto lässt sich ohne Administratorrecht nicht bestätigen", async () => {
    const owner = await env.user({ username: "bernd" });
    const worker = await env.user({ username: "carla" });
    await env.signIn(worker);
    const n = await notice(owner.id, "bernd");
    await actions.acknowledgeNotice(form({ id: n.id }));
    assert.equal((await acks(n.id)).length, 0);
    await actions.acknowledgeNotice(form({ id: "gibt-es-nicht" }));
    assert.equal(await env.db.recoveryNoticeAck.count(), 0);
  });

  it("Administratoren bestätigen den Hinweis zu jedem Konto, auch zu einem gelöschten (Konto leer)", async () => {
    const admin = await env.user({ username: "chef", roles: [await env.role({ key: "admin-r", isAdmin: true })] });
    await env.signIn(admin);
    const other = await env.user({ username: "dora" });
    const n1 = await notice(other.id, "dora");
    const n2 = await notice(null, "gelöscht");
    await actions.acknowledgeNotice(form({ id: n1.id }));
    await actions.acknowledgeNotice(form({ id: n2.id }));
    assert.deepEqual((await acks(n1.id)).map((a) => a.userId), [admin.id]);
    assert.deepEqual((await acks(n2.id)).map((a) => a.userId), [admin.id]);
  });

  it("geht auch beim erzwungenen Passwortwechsel (allowPasswordChange), ohne Sitzung aber nur zur Anmeldung", async () => {
    const user = await env.user({ username: "emil", mustChangePassword: true });
    await env.signIn(user);
    const n = await notice(user.id, "emil");
    await actions.acknowledgeNotice(form({ id: n.id }));
    assert.equal((await acks(n.id)).length, 1);

    env.signOut();
    const m = await notice(user.id, "emil");
    assert.match((await redirectOf(() => actions.acknowledgeNotice(form({ id: m.id })))) ?? "", /^\/login/);
    assert.equal((await acks(m.id)).length, 0);
  });
});
