"use server";

import { z } from "zod";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { confirmRecoveryKey, issueRecoveryKey } from "@/server/recovery-key";
import { resetSecretsByAdministrator } from "@/server/secret-reset";
import { secretHoldings, withHoldings } from "@/server/secret-holdings";
import { SecretKeyUnavailableError } from "@/server/secrets";
import { defineAction, defineOperation, fail } from "@/server/operations";

/**
 * Wiederherstellungsschlüssel (P1b-4a): erzeugen und als gesichert bestätigen. Nur Administratoren mit erneuter Passwortabfrage; der Klartext steht **nur in der Antwort der Aktion**
 * (`state`) – nie in URL, Log, Audit oder Datenbank. Neu erzeugen ersetzt Hülle und Off-Site-Hauptschlüssel; der bisherige Schlüssel wird für neue Backups wertlos
 * (bereits abgelegte Off-Site-Dateien bleiben mit dem alten Schlüssel verschlüsselt).
 *
 * **Auffälliges Audit bei vorhandenen Tresor-Einträgen:** Wer den Wiederherstellungsschlüssel kennt (er wird hier einmal angezeigt) und eine Sicherung hat, kann `secret.key` und damit den Tresor außerhalb der
 * Anwendung lesen, ohne das Tresor-Recht und ohne die Passwortabfrage der Tresor-Anzeige. Gibt es Tresor-Einträge, vermerkt der Eintrag `secrets.keyCreated` das (`Tresor betroffen (n Einträge)`, nie Inhalt) – siehe `secret-holdings.ts`.
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
    return { holdings: await secretHoldings() };
  },
  run: async ({ tx, audit, prepared }) => {
    const key = await issueRecoveryKey(tx);
    audit({ target: withHoldings("–", prepared.holdings) }); // nie der Schlüssel selbst
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

/**
 * Neu anfangen, wenn der Geheimnisschlüssel nicht mehr zu retten ist (weder Wiederherstellungsschlüssel noch die ursprüngliche `secret.key`): legt – nur wenn die Datei fehlt – einen
 * neuen Schlüssel an und setzt alle nicht lesbaren Geheimnisse zurück. Die betroffenen verschlüsselten Zeilen werden vorher als Datei `secret-reset/<Zeit>.json` gesichert
 * (`secret-reset.ts`). Nur Administratoren, mit erneuter Passwortabfrage; eine vorhandene, nicht lesbare `secret.key` wird nie überschrieben.
 */
const resetSecretsOperation = defineOperation({
  name: "admin.backup.resetSecrets",
  permission: "backup.keys",
  input: z.object({ password: z.string().max(1024) }),
  audit: "secrets.resetForced",
  transaction: false, // das Zurücksetzen schreibt selbst (Verbraucher, Sicherungsdatei); der Audit-Eintrag steht danach
  prepare: async ({ input, principal }) => {
    if (!principal.user.isAdmin) fail("forbidden", "recovery.account.errors.adminOnly");
    await confirmOwnPassword(principal.user.id, input.password);
  },
  run: async ({ audit }) => {
    try {
      const result = await resetSecretsByAdministrator();
      audit({ target: [result.newKey ? "neuer Schlüssel" : null, ...result.items.map((i) => `${i.id}: ${i.count}`), result.backup ? `Sicherung secret-reset/${result.backup}` : null].filter(Boolean).join(" · ") || "–" });
      return {};
    } catch (error) {
      if (error instanceof SecretKeyUnavailableError) fail("conflict", "backup.keyIssue.errors.unwritable");
      throw error;
    }
  },
});

export const resetSecrets = defineAction(resetSecretsOperation, {
  form: (fd) => ({ password: String(fd.get("password") ?? "") }),
  revalidate: [["/", "layout"]],
  message: "backup.keyIssue.reset.done",
});
