import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { runMigrations } from "@/server/migrate";
import { chapterFilter, pageFilter } from "./visibility";

const dir = mkdtempSync(path.join(tmpdir(), "so-docs-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("Sichtbarkeit von Kapiteln", () => {
  let db: PrismaClient;
  const file = path.join(dir, "visibility.db");
  before(async () => {
    await runMigrations(file);
    db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  });
  after(() => db.$disconnect());

  it("zeigt eingeschränkte Kapitel nur den genannten Rollen – Seiten ohne Kapitel und offene Kapitel allen", async () => {
    const [office, workshop] = await Promise.all([
      db.role.create({ data: { key: "office", name: "Büro" } }),
      db.role.create({ data: { key: "workshop", name: "Werkstatt" } }),
    ]);
    const open = await db.docCategory.create({ data: { area: "handbook", name: "Allgemein" } });
    const hr = await db.docCategory.create({ data: { area: "handbook", name: "Personal", roles: { create: [{ roleId: office.id }] } } });
    for (const [slug, categoryId] of [["frei", null], ["allgemein", open.id], ["personal", hr.id]] as const) {
      await db.docPage.create({ data: { area: "handbook", slug, title: slug, content: "", categoryId } });
    }
    const slugs = async (viewer: Parameters<typeof pageFilter>[0]) =>
      (await db.docPage.findMany({ where: { area: "handbook", ...pageFilter(viewer) }, orderBy: { slug: "asc" } })).map((p) => p.slug);

    assert.deepEqual(await slugs({ unrestricted: false, roleIds: [office.id] }), ["allgemein", "frei", "personal"]);
    assert.deepEqual(await slugs({ unrestricted: false, roleIds: [workshop.id] }), ["allgemein", "frei"]);
    assert.deepEqual(await slugs({ unrestricted: false, roleIds: [] }), ["allgemein", "frei"]);
    assert.deepEqual(await slugs({ unrestricted: true, roleIds: [] }), ["allgemein", "frei", "personal"]); // Administrator/Bearbeiter

    const chapters = async (viewer: Parameters<typeof chapterFilter>[0]) =>
      (await db.docCategory.findMany({ where: { area: "handbook", ...chapterFilter(viewer) }, orderBy: { name: "asc" } })).map((c) => c.name);
    assert.deepEqual(await chapters({ unrestricted: false, roleIds: [workshop.id] }), ["Allgemein"]);
  });

  it("löscht die Einschränkung mit der Rolle (Kapitel wird dann wieder offen)", async () => {
    const role = await db.role.create({ data: { key: "temp", name: "Temp" } });
    const chapter = await db.docCategory.create({ data: { area: "it", name: "Geheim", roles: { create: [{ roleId: role.id }] } } });
    await db.role.delete({ where: { id: role.id } });
    assert.equal(await db.docCategoryRole.count({ where: { categoryId: chapter.id } }), 0);
    assert.equal(await db.docCategory.count({ where: { id: chapter.id, ...chapterFilter({ unrestricted: false, roleIds: [] }) } }), 1);
  });
});
