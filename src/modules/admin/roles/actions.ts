"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { claimed } from "@/lib/concurrency";
import { checkRoleChange, checkRoleDelete } from "@/lib/rbac";
import { loadActor, toRights } from "@/server/rbac/hierarchy";
import { isPermission } from "@/modules/catalog";
import { audit } from "@/server/audit";

const schema = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).optional(),
});

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "rolle"
  );
}

type Outcome = { state: ActionState } | { roleId: string };

export async function saveRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("roles.manage");
  const { t } = await getI18n();
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;
  const submitted = [...new Set(formData.getAll("permission").map(String).filter(isPermission))];

  // Prüfen (Rechte-Hierarchie, Version) und Schreiben in einer Transaktion
  const outcome: Outcome = await db.$transaction(async (tx): Promise<Outcome> => {
    const actor = await loadActor(tx, session.user.id);
    if (d.id) {
      const role = await tx.role.findUnique({ where: { id: d.id }, include: { permissions: true } });
      if (!role) return { state: { error: t("common.conflict") } };
      // Administrator-Rollen haben immer alle Rechte -> keine Einzelrechte speichern
      const next = role.isAdmin ? [] : submitted;
      const denied = checkRoleChange(actor, toRights(role), next);
      if (denied) return { state: { error: t(`rbac.denied.${denied}`) } };
      if (!(await claimed(d.version, (stamp, stampNext) => tx.role.updateMany({ where: { id: role.id, updatedAt: stamp }, data: { updatedAt: stampNext } })))) {
        return { state: { error: t("common.conflict") } };
      }
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.role.update({
        where: { id: role.id },
        data: { name: d.name, description: d.description ?? null, permissions: { create: next.map((permission) => ({ permission })) } },
      });
      return { roleId: role.id };
    }

    const denied = checkRoleChange(actor, null, submitted);
    if (denied) return { state: { error: t(`rbac.denied.${denied}`) } };
    let key = slug(d.name);
    if (await tx.role.findUnique({ where: { key } })) key = `${key}-${Date.now().toString(36)}`;
    const created = await tx.role.create({
      data: { key, name: d.name, description: d.description ?? null, permissions: { create: submitted.map((permission) => ({ permission })) } },
    });
    return { roleId: created.id };
  });
  if ("state" in outcome) return outcome.state;

  await audit(d.id ? "role.update" : "role.create", { target: d.name, entityId: outcome.roleId });
  revalidatePath("/admin/roles");
  redirect(`/admin/roles?saved=${outcome.roleId}`);
}

export async function deleteRole(formData: FormData) {
  const session = await requirePermission("roles.manage");
  const id = String(formData.get("id") ?? "");

  const result = await db.$transaction(async (tx) => {
    const role = id ? await tx.role.findUnique({ where: { id }, include: { permissions: true } }) : null;
    if (!role || role.isSystem || role.isAdmin) return null;
    const denied = checkRoleDelete(await loadActor(tx, session.user.id), toRights(role));
    if (denied) return { denied };
    await tx.role.delete({ where: { id } });
    return { deleted: role.name };
  });
  if (result && "denied" in result) redirect(`/admin/roles?error=${result.denied}`);
  if (result) await audit("role.delete", { target: result.deleted, entityId: id });
  revalidatePath("/admin/roles");
  redirect("/admin/roles");
}
