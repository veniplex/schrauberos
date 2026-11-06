"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission, revokeSessions } from "@/server/auth/session";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { audit } from "@/server/audit";

const schema = z.object({
  id: z.string().optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,40}$/),
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(200).optional(),
  password: z.string().max(200).optional(),
});

/** Ist nach der Änderung noch mindestens ein aktiver Admin übrig? */
async function otherActiveAdminExists(excludeUserId: string) {
  const count = await db.user.count({
    where: { id: { not: excludeUserId }, active: true, roles: { some: { role: { isAdmin: true } } } },
  });
  return count > 0;
}

export async function saveUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("users.manage");
  const { t } = await getI18n();
  const raw = formObject(formData);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  const roleIds = formData.getAll("roleId").map(String);
  const active = formData.get("active") === "on";
  const mustChangePassword = formData.get("mustChangePassword") === "on";

  const roles = await db.role.findMany({ where: { id: { in: roleIds } } });
  // Nur Admins dürfen Admin-Rollen vergeben oder entziehen (sonst Rechteausweitung)
  const existing = d.id ? await db.user.findUnique({ where: { id: d.id }, include: { roles: { include: { role: true } } } }) : null;
  const adminBefore = existing?.roles.some((r) => r.role.isAdmin) ?? false;
  const adminAfter = roles.some((r) => r.isAdmin);
  if (!session.user.isAdmin && adminBefore !== adminAfter) {
    return { error: t("users.errors.adminRoleRestricted") };
  }

  // Passwort
  const password = d.password && d.password.length > 0 ? d.password : undefined;
  if (!d.id && !password && !(existing?.authSource && existing.authSource !== "local")) {
    return { fieldErrors: { password: t("validation.required") } };
  }
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    return { fieldErrors: { password: t("account.errors.passwordShort", { min: MIN_PASSWORD_LENGTH }) } };
  }

  // Letzten aktiven Admin schützen
  if (d.id && existing && adminBefore && (!adminAfter || !active) && !(await otherActiveAdminExists(d.id))) {
    return { error: t("users.errors.lastAdmin") };
  }
  if (d.id === session.user.id && !active) return { error: t("users.errors.selfDeactivate") };

  const duplicate = await db.user.findFirst({ where: { username: d.username, ...(d.id ? { id: { not: d.id } } : {}) } });
  if (duplicate) return { fieldErrors: { username: t("users.errors.usernameTaken") } };

  const base = {
    name: d.name,
    email: d.email ?? null,
    active,
    mustChangePassword,
    ...(password ? { passwordHash: await hashPassword(password) } : {}),
  };

  let userId = d.id;
  if (d.id) {
    await db.$transaction([
      db.userRole.deleteMany({ where: { userId: d.id } }),
      db.user.update({ where: { id: d.id }, data: { ...base, roles: { create: roles.map((r) => ({ roleId: r.id })) } } }),
    ]);
    // Passwort geändert oder deaktiviert -> bestehende Sitzungen beenden
    if (password || !active) await revokeSessions(d.id, d.id === session.user.id);
  } else {
    const created = await db.user.create({
      data: { ...base, username: d.username, authSource: "local", roles: { create: roles.map((r) => ({ roleId: r.id })) } },
    });
    userId = created.id;
  }

  await audit(d.id ? "user.update" : "user.create", { target: d.username, entityId: userId });
  revalidatePath("/admin/users");
  redirect(`/admin/users?saved=${userId}`);
}

export async function deleteUser(formData: FormData) {
  const session = await requirePermission("users.manage");
  const id = String(formData.get("id") ?? "");
  if (!id || id === session.user.id) redirect("/admin/users");

  const user = await db.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  if (user) {
    const isAdmin = user.roles.some((r) => r.role.isAdmin);
    if (isAdmin && (!session.user.isAdmin || !(await otherActiveAdminExists(id)))) redirect("/admin/users?error=lastAdmin");
    await db.user.delete({ where: { id } });
    await audit("user.delete", { target: user.username, entityId: id });
  }
  revalidatePath("/admin/users");
  redirect("/admin/users");
}
