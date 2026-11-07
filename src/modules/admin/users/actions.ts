"use server";

import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { formObject } from "@/lib/forms";
import { claimRow } from "@/lib/concurrency";
import { checkGrantRole, checkManageUser, type Denial } from "@/lib/rbac";
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_CHARS, passwordProblem } from "@/server/auth/password";
import { revokeAccess } from "@/server/auth/revoke";
import { loginThrottle, normalizeUsername } from "@/server/auth/throttle";
import { defineAction, defineOperation, fail, failField } from "@/server/operations";
import { loadActor, loadRoles, toRights } from "@/server/rbac/hierarchy";
import type { Prisma } from "@/generated/prisma/client";

const deniedKey = (denial: Denial) => `rbac.denied.${denial}` as MessageKey;

const saveInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,40}$/, { error: "validation.username" }),
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(200).optional(),
  password: z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      const problem = value ? passwordProblem(value) : null;
      if (problem === "short") ctx.addIssue({ code: "custom", message: "account.errors.passwordShort", params: { min: MIN_PASSWORD_LENGTH } });
      if (problem === "long") ctx.addIssue({ code: "custom", message: "account.errors.passwordLong", params: { max: MAX_PASSWORD_CHARS } });
    }),
  roleIds: z.array(z.string()),
  active: z.boolean(),
  mustChangePassword: z.boolean(),
});

/** Ist nach der Änderung noch mindestens ein aktiver Admin übrig? */
async function otherActiveAdminExists(tx: Pick<Prisma.TransactionClient, "user">, excludeUserId: string) {
  const count = await tx.user.count({
    where: { id: { not: excludeUserId }, active: true, roles: { some: { role: { isAdmin: true } } } },
  });
  return count > 0;
}

const withRoles = { roles: { include: { role: { include: { permissions: true } } } } } as const;

const saveUserOperation = defineOperation({
  name: "admin.users.save",
  permission: "users.manage",
  input: saveInput,
  audit: (input) => (input.id ? "user.update" : "user.create"),
  // aufwendig, deshalb vor der Transaktion
  prepare: async ({ input }) => ({ passwordHash: input.password ? await hashPassword(input.password) : undefined }),
  run: async ({ input: d, principal, prepared, tx, audit }) => {
    // Prüfen und Schreiben gehören zusammen: Rechte-Hierarchie, Schutz des letzten Administrators und Speichern in einer Transaktion
    const actor = await loadActor(tx, principal.user.id);
    const roles = await loadRoles(tx, d.roleIds);
    const existing = d.id ? await tx.user.findUnique({ where: { id: d.id }, include: withRoles }) : null;
    if (d.id && !existing) fail("conflict");
    const before = (existing?.roles ?? []).map((r) => toRights(r.role));

    // Rechte-Hierarchie: nur Konten ändern, deren Rechte eine Teilmenge der eigenen sind; nur Rollen vergeben/entziehen, die man
    // selbst vollständig besitzt (und keine Verwaltungsrechte). Gilt für Passwort, E-Mail, „aktiv“ und Rollen gleichermaßen.
    if (existing) {
      const denied = checkManageUser(actor, before);
      if (denied) fail("forbidden", deniedKey(denied));
    }
    const beforeIds = new Set(before.map((r) => r.id));
    const afterIds = new Set(roles.map((r) => r.id));
    const changed = [...roles.filter((r) => !beforeIds.has(r.id)), ...before.filter((r) => !afterIds.has(r.id))];
    for (const role of changed) {
      const denied = checkGrantRole(actor, role);
      if (denied) fail("forbidden", deniedKey(denied));
    }

    if (!d.id && !prepared.passwordHash) failField("password", "validation.required");

    // Letzten aktiven Admin schützen
    const adminBefore = before.some((r) => r.isAdmin);
    const adminAfter = roles.some((r) => r.isAdmin);
    if (d.id && existing && adminBefore && (!adminAfter || !d.active) && !(await otherActiveAdminExists(tx, d.id))) fail("forbidden", "users.errors.lastAdmin");
    if (d.id === principal.user.id && !d.active) fail("forbidden", "users.errors.selfDeactivate");

    const duplicate = await tx.user.findFirst({ where: { username: d.username, ...(d.id ? { id: { not: d.id } } : {}) } });
    if (duplicate) failField("username", "users.errors.usernameTaken");

    const base = { name: d.name, email: d.email ?? null, active: d.active, mustChangePassword: d.mustChangePassword, ...(prepared.passwordHash ? { passwordHash: prepared.passwordHash } : {}) };
    let userId: string;
    if (existing) {
      if (!(await claimRow(tx.user, existing.id, d.version))) fail("conflict");
      await tx.userRole.deleteMany({ where: { userId: existing.id } });
      await tx.user.update({ where: { id: existing.id }, data: { ...base, roles: { create: roles.map((r) => ({ roleId: r.id })) } } });
      userId = existing.id;
    } else {
      userId = (await tx.user.create({ data: { ...base, username: d.username, authSource: "local", roles: { create: roles.map((r) => ({ roleId: r.id })) } } })).id;
    }
    audit({ target: d.username, entityId: userId });

    // Passwort geändert oder deaktiviert -> Sitzungen, bekannte Geräte und API-Tokens beenden – in derselben Transaktion (kein Zustand dazwischen,
    // kein verschlucktes Fehlschlagen nach dem Commit)
    if (d.id && (d.password || !d.active)) await revokeAccess(tx, d.id, { exceptCurrent: d.id === principal.user.id });
    return { userId };
  },
});

export const saveUser = defineAction(saveUserOperation, {
  form: (fd) => ({
    ...formObject(fd),
    roleIds: [...new Set(fd.getAll("roleId").map(String))],
    active: fd.get("active") === "on",
    mustChangePassword: fd.get("mustChangePassword") === "on",
  }),
  revalidate: ["/admin/users"],
  redirect: ({ userId }) => `/admin/users?saved=${userId}`,
});

const idInput = z.object({ id: z.string().min(1) });

const unlockUserOperation = defineOperation({
  name: "admin.users.unlock",
  permission: "users.manage",
  input: idInput,
  audit: "user.unlock",
  run: async ({ input, principal, tx, audit, afterCommit }) => {
    // Wartezeit nach Fehlversuchen aufheben (Administration) – gleiche Rechte-Hierarchie wie beim Ändern des Kontos.
    const user = await tx.user.findUnique({ where: { id: input.id }, include: withRoles });
    if (!user) fail("notFound");
    const denied = checkManageUser(await loadActor(tx, principal.user.id), user.roles.map((r) => toRights(r.role)));
    if (denied) fail("forbidden", deniedKey(denied));
    // Ohne `updatedAt` zu ändern (das Benutzerformular nutzt es als Version; wie die Anmeldezähler in `updateLoginState`)
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, updatedAt: user.updatedAt } });
    afterCommit(() => loginThrottle.accounts.reset(normalizeUsername(user.username)));
    audit({ target: user.username, entityId: user.id });
    return { id: user.id };
  },
});

export const unlockUser = defineAction(unlockUserOperation, {
  revalidate: ["/admin/users"],
  redirect: ({ id }) => `/admin/users/${id}?unlocked=1`,
});

const deleteUserOperation = defineOperation({
  name: "admin.users.delete",
  permission: "users.manage",
  input: idInput,
  audit: "user.delete",
  run: async ({ input, principal, tx, audit }) => {
    if (input.id === principal.user.id) fail("forbidden", "users.errors.selfDelete");
    const actor = await loadActor(tx, principal.user.id);
    const user = await tx.user.findUnique({ where: { id: input.id }, include: withRoles });
    if (!user) fail("notFound");
    const roles = user.roles.map((r) => toRights(r.role));
    const denied = checkManageUser(actor, roles);
    if (denied) fail("forbidden", deniedKey(denied));
    if (roles.some((r) => r.isAdmin) && !(await otherActiveAdminExists(tx, input.id))) fail("forbidden", "users.errors.lastAdmin");
    await tx.user.delete({ where: { id: input.id } });
    audit({ target: user.username, entityId: input.id });
    return { id: input.id };
  },
});

export const deleteUser = defineAction(deleteUserOperation, {
  revalidate: ["/admin/users"],
  redirect: "/admin/users",
  message: "common.deleted",
  redirectOnError: "/admin/users",
});
