"use server";

import { z } from "zod";
import { formObject } from "@/lib/forms";
import { accountOwner, hashPassword, MAX_PASSWORD_CHARS, MIN_PASSWORD_LENGTH, passwordProblem, verifyPassword } from "@/server/auth/password";
import { revokeAccess } from "@/server/auth/revoke";
import { loginThrottle } from "@/server/auth/throttle";
import { db } from "@/server/db";
import { defineAction, defineOperation, fail, failField } from "@/server/operations";

const profileInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(200).optional(),
});

const saveProfileOperation = defineOperation({
  name: "account.saveProfile",
  permission: "authenticated",
  allowPasswordChange: true,
  input: profileInput,
  audit: "account.profile",
  run: async ({ input, principal, tx, audit }) => {
    await tx.user.update({ where: { id: principal.user.id }, data: { name: input.name, email: input.email ?? null } });
    audit({ target: principal.user.username, entityId: principal.user.id });
    return {};
  },
});

export const saveProfile = defineAction(saveProfileOperation, { form: formObject, revalidate: [["/", "layout"]], message: "common.saved" });

/** Passwörter werden nie getrimmt oder sonst verändert (führende/abschließende Leerzeichen gehören dazu). */
const passwordForm = (fd: FormData) => ({
  current: String(fd.get("current") ?? ""),
  next: String(fd.get("next") ?? ""),
  confirm: String(fd.get("confirm") ?? ""),
});

const changePasswordInput = z
  .object({
    current: z.string().max(1024),
    next: z.string().max(1024),
    confirm: z.string().max(1024),
  })
  .superRefine((d, ctx) => {
    const problem = passwordProblem(d.next);
    if (problem === "short") ctx.addIssue({ code: "custom", message: "account.errors.passwordShort", params: { min: MIN_PASSWORD_LENGTH }, path: ["next"] });
    else if (problem === "long") ctx.addIssue({ code: "custom", message: "account.errors.passwordLong", params: { max: MAX_PASSWORD_CHARS }, path: ["next"] });
    else if (d.next !== d.confirm) ctx.addIssue({ code: "custom", message: "account.errors.mismatch", path: ["confirm"] });
  });

const changePasswordOperation = defineOperation({
  name: "account.changePassword",
  permission: "authenticated",
  allowPasswordChange: true,
  input: changePasswordInput,
  audit: "account.password",
  // Die Passwortprüfung und das Hashen sind aufwendig und gehören nicht in die Transaktion (SQLite hat nur einen Schreiber)
  prepare: async ({ input, principal }) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: principal.user.id } });
    if (user.authSource !== "local") fail("forbidden", "account.errors.externalPassword");
    // Eigenes Limit: Die Prüfung des aktuellen Passworts darf mit einer gestohlenen Sitzung kein unbegrenztes Rätselraten erlauben
    const gate = loginThrottle.passwordChange;
    const wait = gate.check(user.id);
    if (wait > 0) fail("forbidden", "account.errors.tooManyAttempts", { seconds: Math.ceil(wait / 1000) });
    gate.take(user.id);
    if (!(await verifyPassword(input.current, user.passwordHash, { owner: accountOwner(principal.user.id) }))) failField("current", "account.errors.currentWrong");
    gate.succeed(user.id);
    if (input.next === input.current) failField("next", "account.errors.sameAsOld");
    return { passwordHash: await hashPassword(input.next, accountOwner(principal.user.id)), wasForced: user.mustChangePassword };
  },
  run: async ({ principal, prepared, tx, audit }) => {
    await tx.user.update({ where: { id: principal.user.id }, data: { passwordHash: prepared.passwordHash, mustChangePassword: false } });
    audit({ target: principal.user.username, entityId: principal.user.id });
    // Alle anderen Geräte abmelden und die API-Tokens des Kontos widerrufen – in derselben Transaktion
    await revokeAccess(tx, principal.user.id, { exceptCurrent: true });
    return { wasForced: prepared.wasForced };
  },
});

export const changePassword = defineAction(changePasswordOperation, {
  form: passwordForm,
  redirect: ({ wasForced }) => (wasForced ? "/" : undefined),
  message: "account.passwordChanged",
});
