"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission, resetAccountThrottle, revokeSessions } from "@/server/auth/session";
import { revokeDevices } from "@/server/auth/devices";
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_CHARS, passwordProblem } from "@/server/auth/password";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { audit } from "@/server/audit";
import { claimed } from "@/lib/concurrency";
import { checkGrantRole, checkManageUser } from "@/lib/rbac";
import { loadActor, loadRoles, toRights } from "@/server/rbac/hierarchy";
import type { Prisma } from "@/generated/prisma/client";

const schema = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,40}$/),
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(200).optional(),
  password: z.string().optional(),
});

/** Ist nach der Änderung noch mindestens ein aktiver Admin übrig? */
async function otherActiveAdminExists(tx: Pick<Prisma.TransactionClient, "user">, excludeUserId: string) {
  const count = await tx.user.count({
    where: { id: { not: excludeUserId }, active: true, roles: { some: { role: { isAdmin: true } } } },
  });
  return count > 0;
}

type Outcome = { state: ActionState } | { userId: string };

export async function saveUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("users.manage");
  const { t } = await getI18n();
  const raw = formObject(formData);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  const roleIds = [...new Set(formData.getAll("roleId").map(String))];
  const active = formData.get("active") === "on";
  const mustChangePassword = formData.get("mustChangePassword") === "on";

  // Passwort
  const password = d.password && d.password.length > 0 ? d.password : undefined;
  const problem = password ? passwordProblem(password) : null;
  if (problem === "short") return { fieldErrors: { password: t("account.errors.passwordShort", { min: MIN_PASSWORD_LENGTH }) } };
  if (problem === "long") return { fieldErrors: { password: t("account.errors.passwordLong", { max: MAX_PASSWORD_CHARS }) } };
  const passwordHash = password ? await hashPassword(password) : undefined; // aufwendig, deshalb vor der Transaktion

  // Prüfen und Schreiben gehören zusammen: Rechte-Hierarchie, Schutz des letzten Administrators und Speichern in einer Transaktion
  const outcome: Outcome = await db.$transaction(async (tx): Promise<Outcome> => {
    const actor = await loadActor(tx, session.user.id);
    const roles = await loadRoles(tx, roleIds);
    const existing = d.id
      ? await tx.user.findUnique({ where: { id: d.id }, include: { roles: { include: { role: { include: { permissions: true } } } } } })
      : null;
    if (d.id && !existing) return { state: { error: t("common.conflict") } };
    const before = (existing?.roles ?? []).map((r) => toRights(r.role));

    // Rechte-Hierarchie: nur Konten ändern, deren Rechte eine Teilmenge der eigenen sind; nur Rollen vergeben/entziehen, die man
    // selbst vollständig besitzt (und keine Verwaltungsrechte). Gilt für Passwort, E-Mail, „aktiv“ und Rollen gleichermaßen.
    if (existing) {
      const denied = checkManageUser(actor, before);
      if (denied) return { state: { error: t(`rbac.denied.${denied}`) } };
    }
    const beforeIds = new Set(before.map((r) => r.id));
    const afterIds = new Set(roles.map((r) => r.id));
    const changed = [...roles.filter((r) => !beforeIds.has(r.id)), ...before.filter((r) => !afterIds.has(r.id))];
    for (const role of changed) {
      const denied = checkGrantRole(actor, role);
      if (denied) return { state: { error: t(`rbac.denied.${denied}`) } };
    }

    if (!d.id && !passwordHash) return { state: { fieldErrors: { password: t("validation.required") } } };

    // Letzten aktiven Admin schützen
    const adminBefore = before.some((r) => r.isAdmin);
    const adminAfter = roles.some((r) => r.isAdmin);
    if (d.id && existing && adminBefore && (!adminAfter || !active) && !(await otherActiveAdminExists(tx, d.id))) {
      return { state: { error: t("users.errors.lastAdmin") } };
    }
    if (d.id === session.user.id && !active) return { state: { error: t("users.errors.selfDeactivate") } };

    const duplicate = await tx.user.findFirst({ where: { username: d.username, ...(d.id ? { id: { not: d.id } } : {}) } });
    if (duplicate) return { state: { fieldErrors: { username: t("users.errors.usernameTaken") } } };

    const base = { name: d.name, email: d.email ?? null, active, mustChangePassword, ...(passwordHash ? { passwordHash } : {}) };
    if (existing) {
      if (!(await claimed(d.version, (stamp, next) => tx.user.updateMany({ where: { id: existing.id, updatedAt: stamp }, data: { updatedAt: next } })))) {
        return { state: { error: t("common.conflict") } };
      }
      await tx.userRole.deleteMany({ where: { userId: existing.id } });
      await tx.user.update({ where: { id: existing.id }, data: { ...base, roles: { create: roles.map((r) => ({ roleId: r.id })) } } });
      return { userId: existing.id };
    }
    const created = await tx.user.create({ data: { ...base, username: d.username, authSource: "local", roles: { create: roles.map((r) => ({ roleId: r.id })) } } });
    return { userId: created.id };
  });
  if ("state" in outcome) return outcome.state;
  const userId = outcome.userId;

  // Passwort geändert oder deaktiviert -> bestehende Sitzungen beenden
  if (d.id && (password || !active)) {
    await revokeSessions(d.id, d.id === session.user.id);
    await revokeDevices(d.id, d.id === session.user.id);
  }
  await audit(d.id ? "user.update" : "user.create", { target: d.username, entityId: userId });
  revalidatePath("/admin/users");
  redirect(`/admin/users?saved=${userId}`);
}

/** Wartezeit nach Fehlversuchen aufheben (Administration) – gleiche Rechte-Hierarchie wie beim Ändern des Kontos. */
export async function unlockUser(formData: FormData) {
  const session = await requirePermission("users.manage");
  const id = String(formData.get("id") ?? "");
  const denied = await db.$transaction(async (tx) => {
    const user = id ? await tx.user.findUnique({ where: { id }, include: { roles: { include: { role: { include: { permissions: true } } } } } }) : null;
    if (!user) return "missing" as const;
    return checkManageUser(await loadActor(tx, session.user.id), user.roles.map((r) => toRights(r.role)));
  });
  if (denied === "missing") redirect("/admin/users");
  if (denied) redirect(`/admin/users?error=${denied}`);
  await resetAccountThrottle(id);
  await audit("user.unlock", { entityId: id });
  revalidatePath("/admin/users");
  redirect(`/admin/users/${id}?unlocked=1`);
}

export async function deleteUser(formData: FormData) {
  const session = await requirePermission("users.manage");
  const id = String(formData.get("id") ?? "");
  if (!id || id === session.user.id) redirect("/admin/users");

  const result = await db.$transaction(async (tx) => {
    const actor = await loadActor(tx, session.user.id);
    const user = await tx.user.findUnique({ where: { id }, include: { roles: { include: { role: { include: { permissions: true } } } } } });
    if (!user) return null;
    const roles = user.roles.map((r) => toRights(r.role));
    const denied = checkManageUser(actor, roles);
    if (denied) return { denied };
    if (roles.some((r) => r.isAdmin) && !(await otherActiveAdminExists(tx, id))) return { denied: "lastAdmin" as const };
    await tx.user.delete({ where: { id } });
    return { deleted: user.username };
  });
  if (result && "denied" in result) redirect(`/admin/users?error=${result.denied}`);
  if (result) await audit("user.delete", { target: result.deleted, entityId: id });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}
