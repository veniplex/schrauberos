import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { runMigrations } from "@/server/migrate";
import { chapterFilter, pageFilter } from "./visibility";

const MIGRATIONS = path.resolve(process.cwd(), "prisma/migrations");
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

describe("Migration „Handbuch“", () => {
  it("übernimmt Werkstatt- und Büro-Dokumentation ins Handbuch und mappt die Rechte", async () => {
    // Stand vor der Migration: alle Migrationen außer der Handbuch-Migration
    const before = path.join(dir, "migrations-before");
    for (const name of readdirSync(MIGRATIONS)) if (!name.endsWith("_handbook")) cpSync(path.join(MIGRATIONS, name), path.join(before, name), { recursive: true });
    const file = path.join(dir, "handbook.db");
    await runMigrations(file, before);

    const raw = new Database(file);
    raw.exec(`
      INSERT INTO "Role" (id, key, name) VALUES ('r1', 'advisor', 'Serviceberater'), ('r2', 'office', 'Büro');
      INSERT INTO "RolePermission" (roleId, permission) VALUES ('r1', 'docsWorkshop.view'), ('r2', 'docsOffice.view'), ('r2', 'docsOffice.edit'), ('r2', 'docsWorkshop.view'), ('r2', 'invoices.view');
      INSERT INTO "FeatureSetting" (key, enabled, updatedAt) VALUES ('office.docs', 0, CURRENT_TIMESTAMP), ('office.fleet', 0, CURRENT_TIMESTAMP);
      INSERT INTO "DocCategory" (id, area, name) VALUES ('c1', 'workshop', 'Allgemein'), ('c2', 'office', 'Allgemein'), ('c3', 'it', 'Allgemein');
      INSERT INTO "DocPage" (id, area, categoryId, title, slug, content, updatedAt) VALUES
        ('p1', 'workshop', 'c1', 'Start', 'start', '', CURRENT_TIMESTAMP),
        ('p2', 'office', 'c2', 'Start', 'start', '', CURRENT_TIMESTAMP),
        ('p3', 'office', NULL, 'Preise', 'preise', '', CURRENT_TIMESTAMP),
        ('p4', 'it', 'c3', 'Start', 'start', '', CURRENT_TIMESTAMP);
      INSERT INTO "DocImage" (id, area, name, mime, size, path) VALUES ('i1', 'office', 'a.png', 'image/png', 1, 'doku/office/a.png');
    `);
    raw.close();

    assert.deepEqual(await runMigrations(file), ["20261106140000_handbook"]);

    const db = new Database(file, { readonly: true });
    const all = (sql: string) => db.prepare(sql).all() as Array<Record<string, string>>;
    assert.deepEqual(all(`SELECT id, area, slug FROM "DocPage" ORDER BY id`), [
      { id: "p1", area: "handbook", slug: "start" },
      { id: "p2", area: "handbook", slug: "buero-start" }, // gleiche Adresse wie p1: Büro-Seite bekommt einen Präfix
      { id: "p3", area: "handbook", slug: "preise" },
      { id: "p4", area: "it", slug: "start" }, // IT bleibt unberührt
    ]);
    assert.deepEqual(all(`SELECT id, area, name FROM "DocCategory" ORDER BY id`), [
      { id: "c1", area: "handbook", name: "Werkstatt: Allgemein" },
      { id: "c2", area: "handbook", name: "Büro: Allgemein" },
      { id: "c3", area: "it", name: "Allgemein" },
    ]);
    assert.equal(all(`SELECT area FROM "DocImage"`)[0].area, "handbook");
    assert.deepEqual(all(`SELECT roleId, permission FROM "RolePermission" ORDER BY roleId, permission`), [
      { roleId: "r1", permission: "handbook.view" },
      { roleId: "r2", permission: "handbook.edit" },
      { roleId: "r2", permission: "handbook.view" },
      { roleId: "r2", permission: "invoices.view" },
    ]);
    assert.deepEqual(all(`SELECT key FROM "FeatureSetting"`), [{ key: "office.fleet" }]);
    db.close();
  });
});
