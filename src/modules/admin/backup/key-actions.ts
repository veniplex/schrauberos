"use server";

import { z } from "zod";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { confirmRecoveryKey, issueRecoveryKey } from "@/server/recovery-key";
import { defineAction, defineOperation, fail } from "@/server/operations";

/**
 * Wiederherstellungsschlüssel (P1b-4a): erzeugen und als gesichert bestätigen. Nur Administratoren mit erneuter Passwortabfrage; der Klartext steht **nur in der Antwort der Aktion**
 * (`state`) – nie in URL, Log, Audit oder Datenbank. Neu erzeugen ersetzt Hülle und Off-Site-Hauptschlüssel; der bisherige Schlüssel wird für neue Backups wertlos
 * (bereits abgelegte Off-Site-Dateien bleiben mit dem alten Schlüssel verschlüsselt).
 */
const createRecoveryKeyOperation = defineOperation({
  name: "admin.backup.createRecoveryKey",
  permission: "backup.keys",
  input: z.object({ password: z.string().max(1024) }),
  audit: "secrets.keyCreated",
  // Passwortprüfung außerhalb der Transaktion (aufwendig, eigener Pfad `ownerLane`)
  prepare: async ({ input, principal }) => {
    if (!principal.user.isAdmin) fail("forbidden", "recovery.account.errors.adminOnly");
    await confirmOwnPassword(principal.user.id, input.password);
  },
  run: async ({ tx, audit }) => {
    const key = await issueRecoveryKey(tx);
    audit({ target: "–" }); // nie der Schlüssel selbst
    return { key };
  },
});

export const createRecoveryKey = defineAction(createRecoveryKeyOperation, {
  form: (fd) => ({ password: String(fd.get("password") ?? "") }),
  revalidate: ["/admin/backup", "/admin/backup/key", "/admin/backup/offsite"],
  state: ({ key }, _input, { date }) => ({ recoveryKey: key, issuedOn: date(new Date(), { dateStyle: "medium" }) }),
});

/** „Ich habe den Schlüssel gesichert“: merkt die Bestätigung (Off-Site und die Einrichtungs-Checkliste fragen sie ab). */
const confirmRecoveryKeyOperation = defineOperation({
  name: "admin.backup.confirmRecoveryKey",
  permission: "backup.keys",
  input: z.object({}),
  audit: "secrets.keyConfirmed",
  run: async ({ tx, principal }) => {
    if (!principal.user.isAdmin) fail("forbidden", "recovery.account.errors.adminOnly");
    if (!(await confirmRecoveryKey(tx))) fail("notFound");
    return {};
  },
});

export const confirmRecoveryKeyAction = defineAction(confirmRecoveryKeyOperation, { revalidate: ["/admin/backup", "/admin/backup/key", "/admin/backup/offsite", ["/", "layout"]] });
