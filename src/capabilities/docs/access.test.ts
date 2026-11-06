import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Role, User } from "@/generated/prisma/client";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Zugriff auf Handbuch/Doku: Kapitel mit Seiten sind nicht löschbar (Löschen hebt keine Beschränkung auf), und Bilder sind nur über
 * eine für den Betrachter sichtbare Seite abrufbar (Rückwärtssuche über den aktuellen Seiteninhalt).
 */
let env: TestEnv;
let actions: typeof import("./actions");
let imageRoute: typeof import("@/app/api/docs/images/[id]/route");
let storeFile: typeof import("@/server/files").storeFile;

let adminRole: Role;
let staffRole: Role; // darf lesen
let bossRole: Role; // darf lesen, im eingeschränkten Kapitel zugelassen
let editorRole: Role; // darf bearbeiten
let staff: User;
let boss: User;
let editor: User;
let admin: User;
let restrictedId: string;
let imageId: string;

before(async () => {
  env = await createTestEnv();
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  actions = await import("./actions");
  imageRoute = await import("@/app/api/docs/images/[id]/route");
  storeFile = (await import("@/server/files")).storeFile;
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.docImage.deleteMany();
  await env.db.docPage.deleteMany();
  await env.db.docCategory.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  env.signOut();
  adminRole = await env.role({ key: "admin", isAdmin: true });
  staffRole = await env.role({ key: "staff", permissions: ["handbook.view"] });
  bossRole = await env.role({ key: "boss", permissions: ["handbook.view"] });
  editorRole = await env.role({ key: "editor", permissions: ["handbook.view", "handbook.edit"] });
  staff = await env.user({ username: "staff", roles: [staffRole] });
  boss = await env.user({ username: "boss", roles: [bossRole] });
  editor = await env.user({ username: "editor", roles: [editorRole] });
  admin = await env.user({ username: "admin", roles: [adminRole] });
  restrictedId = (await env.db.docCategory.create({ data: { area: "handbook", name: "Intern", roles: { create: [{ roleId: bossRole.id }] } } })).id;
  const path = await storeFile("doku/handbook", "bild.png", new Uint8Array([137, 80, 78, 71]));
  imageId = (await env.db.docImage.create({ data: { area: "handbook", name: "bild.png", mime: "image/png", size: 4, path } })).id;
});

const page = (slug: string, content: string, categoryId: string | null) =>
  env.db.docPage.create({ data: { area: "handbook", slug, title: slug, content, categoryId } });
const embed = (id = imageId) => `Text ![x](/api/docs/images/${id}) Ende`;
const fetchImage = async (user: User | null, id = imageId) => {
  env.signOut();
  if (user) await env.signIn(user);
  return (await imageRoute.GET({} as never, { params: Promise.resolve({ id }) })).status;
};

describe("Kapitel löschen", () => {
  it("ein Kapitel mit Seiten bleibt samt Beschränkung bestehen; die Seiten bleiben darin", async () => {
    const p = await page("geheim", "x", restrictedId);
    await env.signIn(editor);
    const to = await redirectOf(() => actions.deleteDocCategory(form({ area: "handbook", id: restrictedId })));
    assert.match(to ?? "", /notice=categoryNotEmpty/);
    assert.equal(await env.db.docCategory.count({ where: { id: restrictedId } }), 1);
    assert.equal((await env.db.docPage.findUniqueOrThrow({ where: { id: p.id } })).categoryId, restrictedId);
    assert.equal(await env.db.auditLog.count({ where: { action: "docs.categoryDelete" } }), 0);
  });

  it("ein leeres Kapitel lässt sich löschen und wird protokolliert", async () => {
    await env.signIn(editor);
    await actions.deleteDocCategory(form({ area: "handbook", id: restrictedId }));
    assert.equal(await env.db.docCategory.count(), 0);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "docs.categoryDelete" } });
    assert.equal(entry.target, "Intern");
  });

  it("ohne Bearbeitungsrecht passiert nichts", async () => {
    await env.signIn(staff);
    assert.equal(await redirectOf(() => actions.deleteDocCategory(form({ area: "handbook", id: restrictedId }))), "/forbidden");
    assert.equal(await env.db.docCategory.count(), 1);
  });
});

describe("Bild-Auslieferung", () => {
  it("nur über eine eingeschränkte Seite: zugelassene Rolle ja, andere nein, Bearbeiter und Administrator ja", async () => {
    await page("intern", embed(), restrictedId);
    assert.equal(await fetchImage(boss), 200);
    assert.equal(await fetchImage(staff), 403);
    assert.equal(await fetchImage(editor), 200);
    assert.equal(await fetchImage(admin), 200);
    assert.equal(await fetchImage(null), 401);
  });

  it("über beide Seiten (eingeschränkt und offen): für alle mit Leserecht sichtbar", async () => {
    await page("intern", embed(), restrictedId);
    await page("offen", embed(), null);
    assert.equal(await fetchImage(staff), 200);
  });

  it("als Waise (keine Seite bindet es ein): nur für Editoren", async () => {
    assert.equal(await fetchImage(staff), 403);
    assert.equal(await fetchImage(boss), 403);
    assert.equal(await fetchImage(editor), 200);
  });

  it("alte Fassungen zählen nicht: Nur in einer DocVersion einer offenen Seite → nicht sichtbar", async () => {
    const p = await page("alt", "ohne Bild", null);
    await env.db.docVersion.create({ data: { pageId: p.id, title: "alt", content: embed() } });
    assert.equal(await fetchImage(staff), 403);
  });

  it("nach dem Verschieben der Seite in ein eingeschränktes Kapitel verliert die Rolle den Zugriff", async () => {
    const p = await page("wandert", embed(), null);
    assert.equal(await fetchImage(staff), 200);
    await env.db.docPage.update({ where: { id: p.id }, data: { categoryId: restrictedId } });
    assert.equal(await fetchImage(staff), 403);
    assert.equal(await fetchImage(boss), 200);
  });

  it("ein anderes Bild einer Seite macht dieses Bild nicht sichtbar", async () => {
    await page("offen", embed("anderes-bild-id"), null);
    assert.equal(await fetchImage(staff), 403);
  });

  it("ohne Leserecht auf den Bereich: 403, auch wenn eine offene Seite das Bild enthält", async () => {
    await page("offen", embed(), null);
    const nobody = await env.user({ username: "nobody", roles: [await env.role({ key: "none" })] });
    assert.equal(await fetchImage(nobody), 403);
  });
});
