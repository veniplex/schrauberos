"use server";

import { z } from "zod";
import { accountOwner, verifyPassword } from "@/server/auth/password";
import { acknowledgeRecoveryNotice, replaceRecoveryCode } from "@/server/auth/recovery";
import { loginThrottle } from "@/server/auth/throttle";
import { db } from "@/server/db";
import { defineAction, defineOperation, fail, failField } from "@/server/operations";

/**
 * Wiederherstellungs-Code erzeugen oder neu erzeugen – nur für Administrator-Konten und nur mit erneuter Passwortabfrage. Der
 * bisherige Code wird dabei ungültig (derselbe Schritt in einer Transaktion). Der Klartext steht nur in der Antwort der Aktion
 * (`state`), nie in URL, Log oder Audit.
 */
const createRecoveryCodeOperation = defineOperation({
  name: "account.createRecoveryCode",
  permission: "authenticated",
  input: z.object({ password: z.string().max(1024) }),
  audit: "auth.recoveryCreated",
  // Passwortprüfung außerhalb der Transaktion (aufwendig)
  prepare: async ({ input, principal }) => {
    if (!principal.user.isAdmin) fail("forbidden", "recovery.account.errors.adminOnly");
    const user = await db.user.findUniqueOrThrow({ where: { id: principal.user.id } });
    if (user.authSource !== "local") fail("forbidden", "recovery.account.errors.external");
    // Die Passwortprüfung hat dasselbe eigene Limit wie der Passwortwechsel (gestohlene Sitzung darf nicht raten)
    const gate = loginThrottle.passwordChange;
    const wait = gate.check(user.id);
    if (wait > 0) fail("forbidden", "account.errors.tooManyAttempts", { seconds: Math.ceil(wait / 1000) });
    gate.take(user.id);
    if (!(await verifyPassword(input.password, user.passwordHash, { owner: accountOwner(principal.user.id) }))) failField("password", "account.errors.currentWrong");
    gate.succeed(user.id);
    return { username: user.username };
  },
  run: async ({ principal, prepared, tx, audit }) => {
    const code = await replaceRecoveryCode(tx, principal.user.id);
    audit({ target: prepared.username, entityId: principal.user.id }); // nie der Code selbst
    return { code };
  },
});

export const createRecoveryCode = defineAction(createRecoveryCodeOperation, {
  form: (fd) => ({ password: String(fd.get("password") ?? "") }),
  revalidate: ["/account"],
  state: ({ code }, _input, { date }) => ({ recoveryCode: code, issuedOn: date(new Date(), { dateStyle: "medium" }) }),
});

/** „Ich habe den Code gesichert“ – merkt sich die Bestätigung des eigenen Codes. */
const confirmRecoveryCodeOperation = defineOperation({
  name: "account.confirmRecoveryCode",
  permission: "authenticated",
  allowPasswordChange: true,
  input: z.object({}),
  audit: false,
  auditReason: "Die Bestätigung merkt nur, dass der Code gesichert wurde; Erzeugung und Verwendung des Codes sind protokolliert",
  run: async ({ principal, tx }) => {
    await tx.recoveryCode.updateMany({ where: { userId: principal.user.id, confirmedAt: null }, data: { confirmedAt: new Date() } });
    // Es gibt nur dann etwas zu bestätigen, wenn das Konto einen Code hat (jetzt oder schon früher bestätigt)
    if ((await tx.recoveryCode.count({ where: { userId: principal.user.id, confirmedAt: { not: null } } })) === 0) fail("notFound");
    return {};
  },
});

export const confirmRecoveryCode = defineAction(confirmRecoveryCodeOperation, { revalidate: [["/", "layout"]] });

/** Banner „Notzugang wurde verwendet“ als gesehen markieren (für den angemeldeten Benutzer). */
const acknowledgeNoticeOperation = defineOperation({
  name: "account.acknowledgeNotice",
  permission: "authenticated",
  allowPasswordChange: true,
  input: z.object({ id: z.string().min(1) }),
  audit: false,
  auditReason: "Das Ausblenden des Hinweises ändert keine Daten; die Verwendung des Notzugangs selbst ist protokolliert",
  run: async ({ input, principal, tx }) => {
    await acknowledgeRecoveryNotice(input.id, { id: principal.user.id, isAdmin: principal.user.isAdmin }, tx);
    return {};
  },
});

export const acknowledgeNotice = defineAction(acknowledgeNoticeOperation, { revalidate: [["/", "layout"]] });
