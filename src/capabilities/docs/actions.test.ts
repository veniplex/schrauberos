import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Dokumentation im Aktions-Rahmen: Das Bearbeitungsrecht hängt vom Bereich ab (Handbuch: handbook.edit, IT: docsIt.edit) und wird aus dem
 * Formular gewählt; Seiten, Verlauf, Wiederherstellen, Anheften, Kapitel, Audit.
 */
let env: TestEnv;
let actions: typeof import("./actions");
let DOC_MAX_VERSIONS: number;
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  ({ DOC_MAX_VERSIONS } = await import("./areas"));
});
after(() => env.cleanup());

const login = async (permissions: string[]) => {
  const user = await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] });
  await env.signIn(user);
  return user;
};
const entries = (action: string) => env.db.auditLog.findMany({ where: { action } });
const save = (fields: Record<string, string | boolean | undefined> = {}) => actions.saveDocPage({}, form({ area: "handbook", title: "Annahme", content: "# Annahme\n\nText", ...fields }));

beforeEach(async () => {
  await env.db.docPage.deleteMany();
  await env.db.docCategory.deleteMany();
  await env.db.auditLog.deleteMany();
  env.browser.reset();
});

describe("Bearbeitungsrecht je Bereich", () => {
  it("Handbuch verlangt handbook.edit, IT-Dokumentation docsIt.edit – das Recht des anderen Bereichs genügt nicht", async () => {
    await login(["docsIt.view", "docsIt.edit"]);
    assert.equal(await redirectOf(() => save({ area: "handbook" })), "/forbidden");
    assert.match((await redirectOf(() => save({ area: "it" }))) ?? "", /^\/docs\/it\//);

    await login(["handbook.view", "handbook.edit"]);
    assert.equal(await redirectOf(() => save({ area: "it", title: "Fremd" })), "/forbidden");
    assert.match((await redirectOf(() => save({ area: "handbook" }))) ?? "", /^\/docs\/handbook\//);
    assert.deepEqual((await env.db.docPage.findMany({ orderBy: { area: "asc" } })).map((p) => p.area), ["handbook", "it"]);
  });

  it("ein unbekannter oder fehlender Bereich ändert nichts und führt nicht zu einem Fehler 500", async () => {
    await login(["handbook.edit", "docsIt.edit"]);
    const states = [await save({ area: "geheim" }), await save({ area: undefined })];
    for (const state of states) assert.ok(state.fieldErrors?.area || state.error);
    assert.equal(await env.db.docPage.count(), 0);
  });

  it("Löschen, Anheften, Wiederherstellen und Kapitel folgen demselben Recht", async () => {
    await login(["handbook.edit"]);
    await redirectOf(() => save());
    const page = await env.db.docPage.findFirstOrThrow();
    await login(["docsIt.edit", "handbook.view"]);
    assert.equal(await redirectOf(() => actions.deleteDocPage(form({ area: "handbook", id: page.id }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.togglePin(form({ area: "handbook", id: page.id }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.saveDocCategory({}, form({ area: "handbook", name: "Neu" }))), "/forbidden");
    assert.equal(await env.db.docPage.count(), 1);
    assert.equal(await env.db.docCategory.count(), 0);
  });
});

describe("Seiten", () => {
  it("Anlegen: Adresse aus dem Titel, eindeutig je Bereich; erste Version im Verlauf; Audit", async () => {
    const user = await login(["handbook.edit"]);
    assert.equal(await redirectOf(() => save({ title: "Annahme & Übergabe" })), "/docs/handbook/annahme-uebergabe");
    assert.equal(await redirectOf(() => save({ title: "Annahme & Übergabe" })), "/docs/handbook/annahme-uebergabe-2");
    const page = await env.db.docPage.findFirstOrThrow({ where: { slug: "annahme-uebergabe" }, include: { versions: true } });
    assert.equal(page.createdByName, user.name);
    assert.equal(page.versions.length, 1);
    const [entry] = await entries("docs.create");
    assert.equal(entry.target, "Annahme & Übergabe");
  });

  it("Ändern behält die Adresse, schreibt eine neue Version, prüft die Version der Seite und protokolliert", async () => {
    await login(["handbook.edit"]);
    await redirectOf(() => save());
    const page = await env.db.docPage.findFirstOrThrow();
    const stale = versionOf(page);
    assert.equal(await redirectOf(() => save({ id: page.id, version: stale, title: "Ganz anders", content: "neu" })), "/docs/handbook/annahme");
    const changed = await env.db.docPage.findUniqueOrThrow({ where: { id: page.id }, include: { versions: true } });
    assert.deepEqual([changed.title, changed.slug, changed.content, changed.versions.length], ["Ganz anders", "annahme", "neu", 2]);
    const conflict = await save({ id: page.id, version: stale, content: "veraltet" });
    assert.ok(conflict.error);
    assert.equal((await env.db.docPage.findUniqueOrThrow({ where: { id: page.id } })).content, "neu");
    assert.equal((await entries("docs.update")).length, 1);
  });

  it("eine Seite eines anderen Bereichs lässt sich nicht über den eigenen ändern", async () => {
    await login(["docsIt.edit", "handbook.edit"]);
    await redirectOf(() => save({ area: "it", title: "Intern" }));
    const itPage = await env.db.docPage.findFirstOrThrow();
    const state = await save({ area: "handbook", id: itPage.id, version: versionOf(itPage), title: "Gekapert" });
    assert.ok(state.error);
    assert.equal((await env.db.docPage.findUniqueOrThrow({ where: { id: itPage.id } })).title, "Intern");
  });

  it("der Verlauf behält höchstens DOC_MAX_VERSIONS Fassungen", async () => {
    await login(["handbook.edit"]);
    await redirectOf(() => save());
    const id = (await env.db.docPage.findFirstOrThrow()).id;
    for (let i = 0; i < DOC_MAX_VERSIONS + 5; i++) {
      const row = await env.db.docPage.findUniqueOrThrow({ where: { id } });
      await redirectOf(() => save({ id, version: versionOf(row), content: `Fassung ${i}` }));
    }
    assert.equal(await env.db.docVersion.count({ where: { pageId: id } }), DOC_MAX_VERSIONS);
  });

  it("Wiederherstellen schreibt die alte Fassung als neue Version; fremde Bereiche und unbekannte Versionen werden abgelehnt", async () => {
    await login(["handbook.edit", "docsIt.edit"]);
    await redirectOf(() => save({ content: "erste Fassung" }));
    const page = await env.db.docPage.findFirstOrThrow();
    await redirectOf(() => save({ id: page.id, version: versionOf(page), content: "zweite Fassung" }));
    const first = await env.db.docVersion.findFirstOrThrow({ where: { content: "erste Fassung" } });
    assert.equal(await redirectOf(() => actions.restoreDocVersion(form({ area: "handbook", versionId: first.id }))), "/docs/handbook/annahme");
    const restored = await env.db.docPage.findUniqueOrThrow({ where: { id: page.id }, include: { versions: true } });
    assert.equal(restored.content, "erste Fassung");
    assert.equal(restored.versions.length, 3, "der Verlauf bleibt lückenlos");
    assert.equal((await entries("docs.restore")).length, 1);

    assert.equal(await redirectOf(() => actions.restoreDocVersion(form({ area: "it", versionId: first.id }))), "/docs/it", "andere Bereiche können Fassungen nicht herausholen");
    assert.equal(await redirectOf(() => actions.restoreDocVersion(form({ area: "handbook", versionId: "gibt-es-nicht" }))), "/docs/handbook");
    assert.equal(await env.db.docVersion.count({ where: { pageId: page.id } }), 3);
  });

  it("Anheften schaltet um, ohne Verlauf und Audit; Löschen protokolliert", async () => {
    await login(["handbook.edit"]);
    await redirectOf(() => save());
    const page = await env.db.docPage.findFirstOrThrow();
    await actions.togglePin(form({ area: "handbook", id: page.id }));
    assert.equal((await env.db.docPage.findUniqueOrThrow({ where: { id: page.id } })).pinned, true);
    await actions.togglePin(form({ area: "handbook", id: page.id }));
    assert.equal((await env.db.docPage.findUniqueOrThrow({ where: { id: page.id } })).pinned, false);
    assert.equal(await env.db.docVersion.count({ where: { pageId: page.id } }), 1);
    assert.equal(await env.db.auditLog.count({ where: { action: { not: "docs.create" } } }), 0);

    assert.equal(await redirectOf(() => actions.deleteDocPage(form({ area: "handbook", id: page.id }))), "/docs/handbook");
    assert.equal(await env.db.docPage.count(), 0);
    assert.equal(await env.db.docVersion.count(), 0, "der Verlauf geht mit der Seite");
    assert.equal((await entries("docs.delete"))[0].target, "Annahme");
  });

  it("eine Seite kann nur einem Kapitel desselben Bereichs zugeordnet werden", async () => {
    await login(["handbook.edit", "docsIt.edit"]);
    const own = await env.db.docCategory.create({ data: { area: "handbook", name: "Eigenes" } });
    const foreign = await env.db.docCategory.create({ data: { area: "it", name: "Fremdes" } });
    assert.ok((await save({ categoryId: foreign.id })).fieldErrors?.categoryId);
    assert.ok(await redirectOf(() => save({ categoryId: own.id })));
    assert.equal(await env.db.docPage.count(), 1);
  });
});

describe("Kapitel", () => {
  it("Anlegen mit Rollenbeschränkung: nur vorhandene Rollen werden übernommen; Ändern ersetzt die Rollen; Audit", async () => {
    await login(["handbook.edit"]);
    const boss = await env.role({ key: "boss", name: "Chef" });
    const state = await actions.saveDocCategory({}, form({ area: "handbook", name: "Intern", roleIds: [boss.id, "gibt-es-nicht"] }));
    assert.equal(state.ok, true);
    const cat = await env.db.docCategory.findFirstOrThrow({ include: { roles: true } });
    assert.deepEqual(cat.roles.map((r) => r.roleId), [boss.id]);
    await actions.saveDocCategory({}, form({ area: "handbook", id: cat.id, name: "Intern 2" }));
    const open = await env.db.docCategory.findUniqueOrThrow({ where: { id: cat.id }, include: { roles: true } });
    assert.deepEqual([open.name, open.roles.length], ["Intern 2", 0], "ohne Auswahl sehen alle mit Leserecht das Kapitel");
    assert.equal((await entries("docs.categorySave")).length, 2);
  });

  it("ein Kapitel eines anderen Bereichs lässt sich nicht ändern oder löschen", async () => {
    await login(["handbook.edit"]);
    const foreign = await env.db.docCategory.create({ data: { area: "it", name: "Fremdes" } });
    const changed = await actions.saveDocCategory({}, form({ area: "handbook", id: foreign.id, name: "Gekapert" }));
    assert.ok(changed.error);
    assert.equal(await redirectOf(() => actions.deleteDocCategory(form({ area: "handbook", id: foreign.id }))), "/docs/handbook");
    const still = await env.db.docCategory.findUniqueOrThrow({ where: { id: foreign.id } });
    assert.equal(still.name, "Fremdes");
  });

  it("ein leeres Kapitel lässt sich löschen, eines mit Seiten nicht (mit Hinweis) – beides ohne Verlust der Beschränkung", async () => {
    await login(["handbook.edit"]);
    const cat = await env.db.docCategory.create({ data: { area: "handbook", name: "Mit Seite" } });
    await env.db.docPage.create({ data: { area: "handbook", slug: "s", title: "S", content: "", categoryId: cat.id } });
    assert.equal(await redirectOf(() => actions.deleteDocCategory(form({ area: "handbook", id: cat.id }))), "/docs/handbook");
    assert.equal(await env.db.docCategory.count(), 1);
    await env.db.docPage.deleteMany();
    await actions.deleteDocCategory(form({ area: "handbook", id: cat.id }));
    assert.equal(await env.db.docCategory.count(), 0);
    assert.equal((await entries("docs.categoryDelete")).length, 1);
  });
});
