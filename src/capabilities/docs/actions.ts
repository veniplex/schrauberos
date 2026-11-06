"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import type { AppSession } from "@/server/auth/session";
import { fieldErrors, formObject } from "@/lib/forms";
import { slugify, uniqueSlug } from "@/lib/slug";
import { DOC_MAX_VERSIONS, DOC_PERMISSIONS, isDocArea, type DocArea } from "./areas";
import { audit } from "@/server/audit";

/** Prüft den Bereich aus dem Formular und das Bearbeitungsrecht dafür (jede Action prüft selbst). */
async function requireEdit(areaRaw: string): Promise<{ area: DocArea; session: AppSession }> {
  if (!isDocArea(areaRaw)) throw new Error("Unbekannter Dokumentationsbereich");
  return { area: areaRaw, session: await requirePermission(DOC_PERMISSIONS[areaRaw].edit) };
}

function refresh(area: DocArea, slug?: string) {
  revalidatePath(`/docs/${area}`);
  if (slug) revalidatePath(`/docs/${area}/${slug}`);
}

/** Speichert den Zustand als Version und kürzt den Verlauf. */
async function snapshot(pageId: string, title: string, content: string, savedByName: string) {
  await db.docVersion.create({ data: { pageId, title, content, savedByName } });
  const old = await db.docVersion.findMany({ where: { pageId }, orderBy: { savedAt: "desc" }, skip: DOC_MAX_VERSIONS, select: { id: true } });
  if (old.length) await db.docVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } });
}

/* ───────────── Seiten ───────────── */

const pageSchema = z.object({
  id: z.string().optional(),
  area: z.string(),
  title: z.string().trim().min(1).max(120),
  categoryId: z.string().optional(),
  content: z.string().max(200_000),
});

export async function saveDocPage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formObject(formData);
  const { area, session } = await requireEdit(raw.area ?? "");
  const { t } = await getI18n();
  // content darf leer sein (formObject entfernt leere Felder)
  const parsed = pageSchema.safeParse({ ...raw, content: String(formData.get("content") ?? "") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  if (d.categoryId) {
    const cat = await db.docCategory.findFirst({ where: { id: d.categoryId, area } });
    if (!cat) return { fieldErrors: { categoryId: t("validation.invalid") } };
  }
  const pinned = formData.get("pinned") === "on";

  let slug: string;
  if (d.id) {
    const page = await db.docPage.findFirst({ where: { id: d.id, area } });
    if (!page) return { error: t("validation.invalid") };
    slug = page.slug; // Adresse bleibt stabil, auch wenn der Titel geändert wird (Links in anderen Seiten)
    await db.docPage.update({
      where: { id: page.id },
      data: { title: d.title, content: d.content, categoryId: d.categoryId ?? null, pinned, updatedByName: session.user.name },
    });
    await snapshot(page.id, d.title, d.content, session.user.name);
  } else {
    const taken = (await db.docPage.findMany({ where: { area }, select: { slug: true } })).map((p) => p.slug);
    slug = uniqueSlug(slugify(d.title), taken);
    const created = await db.docPage.create({
      data: { area, slug, title: d.title, content: d.content, categoryId: d.categoryId ?? null, pinned, createdByName: session.user.name, updatedByName: session.user.name },
    });
    await snapshot(created.id, d.title, d.content, session.user.name);
  }
  refresh(area, slug);
  redirect(`/docs/${area}/${slug}`);
}

export async function deleteDocPage(formData: FormData) {
  const { area } = await requireEdit(String(formData.get("area") ?? ""));
  const id = String(formData.get("id") ?? "");
  const page = id ? await db.docPage.findFirst({ where: { id, area }, select: { title: true } }) : null;
  if (id) await db.docPage.deleteMany({ where: { id, area } });
  if (page) await audit("docs.delete", { target: page.title, entityId: id });
  refresh(area);
  redirect(`/docs/${area}`);
}

export async function togglePin(formData: FormData) {
  const { area } = await requireEdit(String(formData.get("area") ?? ""));
  const id = String(formData.get("id") ?? "");
  const page = id ? await db.docPage.findFirst({ where: { id, area } }) : null;
  if (page) await db.docPage.update({ where: { id: page.id }, data: { pinned: !page.pinned } });
  refresh(area, page?.slug);
}

/** Alte Fassung wiederherstellen: wird als neue Version gespeichert (der Verlauf bleibt lückenlos). */
export async function restoreDocVersion(formData: FormData) {
  const { area, session } = await requireEdit(String(formData.get("area") ?? ""));
  const versionId = String(formData.get("versionId") ?? "");
  const version = versionId ? await db.docVersion.findUnique({ where: { id: versionId }, include: { page: true } }) : null;
  if (!version || version.page.area !== area) redirect(`/docs/${area}`);
  await db.docPage.update({
    where: { id: version.pageId },
    data: { title: version.title, content: version.content, updatedByName: session.user.name },
  });
  await snapshot(version.pageId, version.title, version.content, session.user.name);
  refresh(area, version.page.slug);
  redirect(`/docs/${area}/${version.page.slug}`);
}

/* ───────────── Kategorien ───────────── */

const categorySchema = z.object({
  id: z.string().optional(),
  area: z.string(),
  name: z.string().trim().min(1).max(60),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export async function saveDocCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formObject(formData);
  const { area } = await requireEdit(raw.area ?? "");
  const { t } = await getI18n();
  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, name, sortOrder } = parsed.data;

  if (id) {
    const cat = await db.docCategory.findFirst({ where: { id, area } });
    if (cat) await db.docCategory.update({ where: { id }, data: { name, sortOrder } });
  } else {
    await db.docCategory.create({ data: { area, name, sortOrder } });
  }
  refresh(area);
  return { ok: true, message: t("common.saved") };
}

export async function deleteDocCategory(formData: FormData) {
  const { area } = await requireEdit(String(formData.get("area") ?? ""));
  const id = String(formData.get("id") ?? "");
  if (id) await db.docCategory.deleteMany({ where: { id, area } });
  refresh(area);
}
