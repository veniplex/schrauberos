"use server";

import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { formObject } from "@/lib/forms";
import { slugify, uniqueSlug } from "@/lib/slug";
import { defineAction, defineOperation, fail, failField, type Tx } from "@/server/operations";
import { DOC_AREAS, DOC_MAX_VERSIONS, DOC_PERMISSIONS, isDocArea, type DocArea } from "./areas";

/**
 * Dokumentation (Handbuch, IT-Dokumentation): Das Bearbeitungsrecht hängt vom Bereich ab (`<gruppe>.edit`). Der Bereich steht im Formular;
 * `permissionFor` wählt daraus das Recht, ohne gültigen Bereich gilt das des ersten Bereichs (die Eingabeprüfung lehnt ihn danach ab).
 */
const FALLBACK = DOC_PERMISSIONS[DOC_AREAS[0]].edit;
const editPermissionFor = (raw: unknown) => {
  const area = typeof raw === "object" && raw !== null ? String((raw as Record<string, unknown>).area ?? "") : "";
  return isDocArea(area) ? DOC_PERMISSIONS[area].edit : FALLBACK;
};

const area = z.string().refine((value): value is DocArea => isDocArea(value), { error: "validation.invalid" });
const idInput = z.object({ area, id: z.string().min(1) });

/** Zielseite nach einem Fehler: der Bereich aus dem Formular, wenn er gültig ist. */
const areaHome = (formData: FormData) => {
  const name = String(formData.get("area") ?? "");
  return isDocArea(name) ? `/docs/${name}` : "/";
};

const refresh = (areaName: string, slug?: string) => [`/docs/${areaName}`, ...(slug ? [`/docs/${areaName}/${slug}`] : [])];

/** Speichert den Zustand als Version und kürzt den Verlauf. */
async function snapshot(tx: Tx, pageId: string, title: string, content: string, savedByName: string) {
  await tx.docVersion.create({ data: { pageId, title, content, savedByName } });
  const old = await tx.docVersion.findMany({ where: { pageId }, orderBy: { savedAt: "desc" }, skip: DOC_MAX_VERSIONS, select: { id: true } });
  if (old.length) await tx.docVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } });
}

/* ───────────── Seiten ───────────── */

const pageInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  area,
  title: z.string().trim().min(1).max(120),
  categoryId: z.string().optional(),
  content: z.string().max(200_000),
  pinned: z.boolean(),
});

const saveDocPageOperation = defineOperation({
  name: "docs.savePage",
  permission: FALLBACK,
  permissionFor: editPermissionFor,
  input: pageInput,
  audit: (input) => (input.id ? "docs.update" : "docs.create"),
  run: async ({ input: d, principal, tx, audit }) => {
    if (d.categoryId && !(await tx.docCategory.findFirst({ where: { id: d.categoryId, area: d.area }, select: { id: true } }))) failField("categoryId", "validation.invalid");

    const by = principal.user.name;
    let slug: string;
    let id: string;
    if (d.id) {
      const page = await tx.docPage.findFirst({ where: { id: d.id, area: d.area } });
      if (!page) fail("invalid", "validation.invalid");
      if (!(await claimRow(tx.docPage, page.id, d.version))) fail("conflict");
      slug = page.slug; // Adresse bleibt stabil, auch wenn der Titel geändert wird (Links in anderen Seiten)
      id = page.id;
      await tx.docPage.update({ where: { id }, data: { title: d.title, content: d.content, categoryId: d.categoryId ?? null, pinned: d.pinned, updatedByName: by } });
    } else {
      const taken = (await tx.docPage.findMany({ where: { area: d.area }, select: { slug: true } })).map((p) => p.slug);
      slug = uniqueSlug(slugify(d.title), taken);
      id = (await tx.docPage.create({ data: { area: d.area, slug, title: d.title, content: d.content, categoryId: d.categoryId ?? null, pinned: d.pinned, createdByName: by, updatedByName: by } })).id;
    }
    await snapshot(tx, id, d.title, d.content, by);
    audit({ target: d.title, entityId: id });
    return { id, slug, area: d.area };
  },
});

export const saveDocPage = defineAction(saveDocPageOperation, {
  // content darf leer sein (formObject entfernt leere Felder)
  form: (fd) => ({ ...formObject(fd), content: String(fd.get("content") ?? ""), pinned: fd.get("pinned") === "on" }),
  revalidate: ({ area: a, slug }) => refresh(a, slug),
  redirect: ({ area: a, slug }) => `/docs/${a}/${slug}`,
});

const deleteDocPageOperation = defineOperation({
  name: "docs.deletePage",
  permission: FALLBACK,
  permissionFor: editPermissionFor,
  input: idInput,
  audit: "docs.delete",
  run: async ({ input, tx, audit }) => {
    const page = await tx.docPage.findFirst({ where: { id: input.id, area: input.area }, select: { title: true } });
    if (!page) fail("notFound");
    await tx.docPage.delete({ where: { id: input.id } });
    audit({ target: page.title, entityId: input.id });
    return { area: input.area };
  },
});

export const deleteDocPage = defineAction(deleteDocPageOperation, {
  revalidate: ({ area: a }) => refresh(a),
  redirect: ({ area: a }) => `/docs/${a}`,
  message: "common.deleted",
  redirectOnError: areaHome,
});

const togglePinOperation = defineOperation({
  name: "docs.togglePin",
  permission: FALLBACK,
  permissionFor: editPermissionFor,
  input: idInput,
  audit: false,
  auditReason: "Anheften ist eine reine Darstellungsänderung; Inhalt und Sichtbarkeit der Seite bleiben unverändert",
  run: async ({ input, tx }) => {
    const page = await tx.docPage.findFirst({ where: { id: input.id, area: input.area } });
    if (!page) fail("notFound");
    // Das Anheften soll weder die Versionsprüfung eines geöffneten Editors (Version = updatedAt) noch „zuletzt geändert“ berühren: updatedAt bleibt, wie es war
    await tx.docPage.update({ where: { id: page.id }, data: { pinned: !page.pinned, updatedAt: page.updatedAt } });
    return { area: input.area, slug: page.slug };
  },
});

export const togglePin = defineAction(togglePinOperation, { revalidate: ({ area: a, slug }) => refresh(a, slug) });

/** Alte Fassung wiederherstellen: wird als neue Version gespeichert (der Verlauf bleibt lückenlos). */
const restoreDocVersionOperation = defineOperation({
  name: "docs.restoreVersion",
  permission: FALLBACK,
  permissionFor: editPermissionFor,
  input: z.object({ area, versionId: z.string().min(1) }),
  audit: "docs.restore",
  run: async ({ input, principal, tx, audit }) => {
    const version = await tx.docVersion.findUnique({ where: { id: input.versionId }, include: { page: true } });
    if (!version || version.page.area !== input.area) fail("notFound");
    await tx.docPage.update({ where: { id: version.pageId }, data: { title: version.title, content: version.content, updatedByName: principal.user.name } });
    await snapshot(tx, version.pageId, version.title, version.content, principal.user.name);
    audit({ target: version.title, entityId: version.pageId });
    return { area: input.area, slug: version.page.slug };
  },
});

export const restoreDocVersion = defineAction(restoreDocVersionOperation, {
  revalidate: ({ area: a, slug }) => refresh(a, slug),
  redirect: ({ area: a, slug }) => `/docs/${a}/${slug}`,
  message: "common.saved",
  redirectOnError: areaHome,
});

/* ───────────── Kategorien ───────────── */

const categoryInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  area,
  name: z.string().trim().min(1).max(60),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  roleIds: z.array(z.string()),
});

const saveDocCategoryOperation = defineOperation({
  name: "docs.saveCategory",
  permission: FALLBACK,
  permissionFor: editPermissionFor,
  input: categoryInput,
  audit: "docs.categorySave",
  run: async ({ input: { id, version, area: a, name, sortOrder, roleIds: wanted }, tx, audit }) => {
    // Nur existierende Rollen übernehmen; leer = das Kapitel sehen alle mit Leserecht
    const roleIds = (await tx.role.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((r) => r.id);
    let saved;
    if (id) {
      const cat = await tx.docCategory.findFirst({ where: { id, area: a } });
      if (!cat) fail("notFound");
      if (!(await claimRow(tx.docCategory, id, version))) fail("conflict");
      saved = await tx.docCategory.update({ where: { id }, data: { name, sortOrder, roles: { deleteMany: {}, create: roleIds.map((roleId) => ({ roleId })) } } });
    } else {
      saved = await tx.docCategory.create({ data: { area: a, name, sortOrder, roles: { create: roleIds.map((roleId) => ({ roleId })) } } });
    }
    audit({ target: name, entityId: saved.id });
    return { area: a };
  },
});

export const saveDocCategory = defineAction(saveDocCategoryOperation, {
  form: (fd) => ({ ...formObject(fd), roleIds: fd.getAll("roleIds").map(String) }),
  revalidate: ({ area: a }) => refresh(a),
  message: "common.saved",
});

const deleteDocCategoryOperation = defineOperation({
  name: "docs.deleteCategory",
  permission: FALLBACK,
  permissionFor: editPermissionFor,
  input: idInput,
  audit: "docs.categoryDelete",
  run: async ({ input, tx, audit }) => {
    const category = await tx.docCategory.findFirst({ where: { id: input.id, area: input.area }, select: { name: true } });
    if (!category) fail("notFound");
    // Löschen darf keine Beschränkung aufheben: Seiten würden sonst ohne Kapitel für alle sichtbar. Prüfen und Löschen laufen zusammen.
    if ((await tx.docPage.count({ where: { categoryId: input.id } })) > 0) fail("inUse", "docs.categoryNotEmpty");
    await tx.docCategory.delete({ where: { id: input.id } });
    audit({ target: category.name, entityId: input.id });
    return { area: input.area };
  },
});

export const deleteDocCategory = defineAction(deleteDocCategoryOperation, {
  revalidate: ({ area: a }) => refresh(a),
  message: "common.deleted",
  redirectOnError: areaHome,
});
