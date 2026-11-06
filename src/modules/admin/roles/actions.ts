"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { isPermission } from "@/modules/catalog";
import { audit } from "@/server/audit";

const schema = z.object({
  id: z.string().optional(),
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

export async function saveRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("roles.manage");
  const { t } = await getI18n();
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;
  const permissions = formData.getAll("permission").map(String).filter(isPermission);

  let id = d.id;
  if (id) {
    const role = await db.role.findUnique({ where: { id } });
    if (!role) return { error: t("validation.invalid") };
    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId: id } }),
      db.role.update({
        where: { id },
        data: {
          name: d.name,
          description: d.description ?? null,
          // Admin-Rollen haben immer alle Rechte -> keine Einzelrechte speichern
          permissions: { create: role.isAdmin ? [] : permissions.map((permission) => ({ permission })) },
        },
      }),
    ]);
  } else {
    let key = slug(d.name);
    if (await db.role.findUnique({ where: { key } })) key = `${key}-${Date.now().toString(36)}`;
    const created = await db.role.create({
      data: { key, name: d.name, description: d.description ?? null, permissions: { create: permissions.map((permission) => ({ permission })) } },
    });
    id = created.id;
  }

  await audit(d.id ? "role.update" : "role.create", { target: d.name, entityId: id });
  revalidatePath("/admin/roles");
  redirect(`/admin/roles?saved=${id}`);
}

export async function deleteRole(formData: FormData) {
  await requirePermission("roles.manage");
  const id = String(formData.get("id") ?? "");
  const role = id ? await db.role.findUnique({ where: { id } }) : null;
  if (role && !role.isSystem && !role.isAdmin) {
    await db.role.delete({ where: { id } });
    await audit("role.delete", { target: role.name, entityId: id });
  }
  revalidatePath("/admin/roles");
  redirect("/admin/roles");
}
