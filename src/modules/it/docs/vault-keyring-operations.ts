import { z } from "zod";
import { passphraseProblem } from "@/lib/vault-keys";
import { audit as writeAudit } from "@/server/audit";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { loginThrottle } from "@/server/auth/throttle";
import { db } from "@/server/db";
import { defineOperation, fail, failField } from "@/server/operations";
import { throttledRecoveryKey } from "@/server/recovery-key-input";
import { buildKeyring, buildPassphraseWrap, createKeyring, deleteKeyring, lockVault, openWithPassphrase, openWithRecoveryKey, replacePassphrase, unlockVault, vaultMasterKey, VaultLockedError, vaultStatus } from "@/server/vault-keyring";
import { resetVaultEntries } from "./vault-reset";

/**
 * Operationen der **Tresor-Hülle** (Schlüsselkonzept, README „IT-Tresor“): einrichten, entsperren (Passphrase oder Wiederherstellungsschlüssel), sperren, Passphrase ändern, zurücksetzen. Festgelegt (Tests in
 * `vault-keyring.test.ts`):
 *  - **Rechte:** Einrichten, Passphrase ändern und Zurücksetzen verlangen `docs.vaultManage` (und `docs.vault`), Entsperren und Sperren `docs.vault` – beide nur ausdrücklich (`explicitOnly`, auch Administratoren), nie über die API.
 *  - **Passwortabfrage der handelnden Person** (\`confirmOwnPassword\`, Eigentümer-Pfad, Limit \`loginThrottle.vault\`) bei jedem Vorgang außer dem Sperren – wer eine entsperrte Sitzung stiehlt, schaltet den Tresor nicht um.
 *  - **Passphrase falsch:** global gedrosselt (\`loginThrottle.vaultKey\`: 5 freie Versuche, dann 5 s … 90 s – für alle Konten gemeinsam), jeder Fehlversuch steht (höchstens einmal pro Minute) als \`vault.unlockFailed\` im Audit-Log, nie das Eingegebene.
 *    Die scrypt-Ableitung läuft im Eigentümer-Pfad (\`ownerLane\`), vor der Transaktion (\`prepare\`).
 *  - **Jede Entsperrung, Sperrung, Einrichtung, Passphrase-Änderung und jedes Zurücksetzen steht im Audit-Log** (nie Passphrase oder Schlüssel). Der Hauptschlüssel wird erst **nach dem Commit** in den Speicher gelegt.
 *  - **Nie stillschweigend zurücksetzen:** Passphrase vergessen heißt Wiederherstellungsschlüssel; erst wenn beides fehlt, setzt „Tresor zurücksetzen“ (ausdrücklich, mit Sicherung der Zeilen) die Zugangsdaten zurück.
 */
const passwordField = z.string().max(1024);
const passphraseField = z.string().max(2048);

const PASSPHRASE_ERRORS = {
  tooShort: "vault.keyring.errors.tooShort",
  tooLong: "vault.keyring.errors.tooLong",
  weak: "vault.keyring.errors.weak",
  username: "vault.keyring.errors.username",
} as const;

function checkNewPassphrase(passphrase: string, confirm: string, username: string): void {
  const problem = passphraseProblem(passphrase, { username });
  if (problem) failField("passphrase", PASSPHRASE_ERRORS[problem]);
  if (passphrase !== confirm) failField("confirm", "vault.keyring.errors.mismatch");
}

/** Gedrosselte Prüfung der Eingabe einer Passphrase: wirft bei laufender Wartezeit; zählt den Versuch (`succeed` gibt ihn zurück). */
function takeAttempt(): void {
  const gate = loginThrottle.vaultKey;
  const wait = gate.check("vault");
  if (wait > 0) fail("forbidden", "account.errors.tooManyAttempts", { seconds: Math.ceil(wait / 1000) });
  gate.take("vault");
}

const keyringOf = async () => db.vaultKeyring.findUnique({ where: { id: "default" }, select: { id: true } });

/** Tresor einrichten: Passphrase festlegen (Mindestqualität), Hauptschlüssel erzeugen, Tresor ist danach entsperrt. */
export const setupVaultOperation = defineOperation({
  name: "vault.setup",
  permission: "docs.vaultManage",
  input: z.object({ passphrase: passphraseField, confirm: passphraseField, password: passwordField }),
  audit: "vault.setup",
  prepare: async ({ input, principal }) => {
    if (!principal.can("docs.vault")) fail("forbidden");
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
    checkNewPassphrase(input.passphrase, input.confirm, principal.user.username);
    if (await keyringOf()) fail("conflict", "vault.keyring.errors.exists");
    return buildKeyring(input.passphrase, principal.user.id);
  },
  finish: (built, ok) => {
    if (!ok) built?.master.fill(0);
  },
  run: async ({ prepared, principal, tx, audit, afterCommit }) => {
    if (!(await createKeyring(tx, prepared, principal.user.name))) fail("conflict", "vault.keyring.errors.exists");
    audit({ target: "–", entityId: "default" });
    afterCommit(() => {
      unlockVault(prepared.master, principal.user.name);
      prepared.master.fill(0); // die Kopie im Speicher des Prozesses genügt
    });
    return { state: "unlocked" as const };
  },
});

/** Entsperren mit der Passphrase (nach jedem Neustart nötig): Hauptschlüssel in den Speicher. */
export const unlockVaultOperation = defineOperation({
  name: "vault.unlock",
  permission: "docs.vault",
  input: z.object({ passphrase: passphraseField, password: passwordField }),
  audit: "vault.unlock",
  prepare: async ({ input, principal }) => {
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
    if (!input.passphrase) failField("passphrase", "validation.required");
    takeAttempt();
    const opened = await openWithPassphrase(db, input.passphrase, principal.user.id);
    if (!opened.ok) {
      if (opened.reason === "notSetUp") fail("conflict", "vault.errors.notSetUp");
      if (opened.reason === "invalid") fail("conflict", "vault.keyring.errors.invalid");
      failField("passphrase", "vault.keyring.errors.wrong");
    }
    loginThrottle.vaultKey.succeed("vault");
    return { master: opened.master };
  },
  finish: (prepared, ok) => {
    if (!ok) prepared?.master.fill(0);
  },
  onFailure: async ({ principal, failure }) => {
    // Nur eine falsche Passphrase wird protokolliert (gedrosselt: höchstens einmal pro Minute für den ganzen Tresor) – nie, was eingegeben wurde
    if (failure?.fields?.passphrase && loginThrottle.audit.allow("vault:passphrase")) {
      await writeAudit("vault.unlockFailed", { actor: { id: principal.user.id, name: principal.user.name }, target: "–", entityId: "default" });
    }
  },
  run: async ({ prepared, principal, audit, afterCommit }) => {
    audit({ target: "Passphrase", entityId: "default" });
    afterCommit(() => {
      unlockVault(prepared.master, principal.user.name);
      prepared.master.fill(0); // die Kopie im Speicher des Prozesses genügt
    });
    return { state: "unlocked" as const };
  },
});

/** Entsperren mit dem Wiederherstellungsschlüssel (Passphrase vergessen oder Server neu aufgesetzt); danach lässt sich die Passphrase neu setzen. */
export const unlockVaultWithRecoveryKeyOperation = defineOperation({
  name: "vault.unlockRecovery",
  permission: "docs.vault",
  input: z.object({ recoveryKey: z.string().max(200), password: passwordField }),
  audit: "vault.unlockRecovery",
  prepare: async ({ input, principal }) => {
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
    const entered = await throttledRecoveryKey(input.recoveryKey); // global gedrosselt, verlangsamt statt abzuweisen
    if (!entered.ok) failField("recoveryKey", "vault.keyring.errors.recoveryFormat");
    const status = await vaultStatus(db);
    if (status.state === "notSetUp") fail("conflict", "vault.errors.notSetUp");
    if (!status.recovery) fail("conflict", "vault.keyring.errors.noRecoveryWrap");
    const master = await openWithRecoveryKey(db, entered.key);
    if (!master) failField("recoveryKey", "vault.keyring.errors.recoveryWrong");
    entered.accept();
    return { master };
  },
  finish: (prepared, ok) => {
    if (!ok) prepared?.master.fill(0);
  },
  onFailure: async ({ principal, failure }) => {
    if (failure?.fields?.recoveryKey && loginThrottle.audit.allow("vault:recovery")) {
      await writeAudit("vault.unlockFailed", { actor: { id: principal.user.id, name: principal.user.name }, target: "Wiederherstellungsschlüssel", entityId: "default" });
    }
  },
  run: async ({ prepared, principal, audit, afterCommit }) => {
    audit({ target: "Wiederherstellungsschlüssel", entityId: "default" });
    afterCommit(() => {
      unlockVault(prepared.master, principal.user.name);
      prepared.master.fill(0); // die Kopie im Speicher des Prozesses genügt
    });
    return { state: "unlocked" as const };
  },
});

/** Sperren: der Hauptschlüssel verschwindet aus dem Speicher (jeder Berechtigte darf, ohne Passwortabfrage – sperren verengt nur). */
export const lockVaultOperation = defineOperation({
  name: "vault.lock",
  permission: "docs.vault",
  input: z.object({}),
  audit: "vault.lock",
  run: async ({ audit, afterCommit }) => {
    audit({ target: "–", entityId: "default" });
    afterCommit(() => lockVault());
    return { state: "locked" as const };
  },
});

/** Passphrase ändern: nur bei entsperrtem Tresor; tauscht Hülle und Salz, die Einträge bleiben unberührt (kein Neuverschlüsseln). */
export const changeVaultPassphraseOperation = defineOperation({
  name: "vault.passphrase",
  permission: "docs.vaultManage",
  input: z.object({ passphrase: passphraseField, confirm: passphraseField, password: passwordField }),
  audit: "vault.passphrase",
  prepare: async ({ input, principal }) => {
    if (!principal.can("docs.vault")) fail("forbidden");
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
    checkNewPassphrase(input.passphrase, input.confirm, principal.user.username);
    if (!(await keyringOf())) fail("conflict", "vault.errors.notSetUp");
    let master: Buffer;
    try {
      master = vaultMasterKey();
    } catch (error) {
      if (error instanceof VaultLockedError) fail("conflict", "vault.errors.locked");
      throw error;
    }
    return buildPassphraseWrap(master, input.passphrase, principal.user.id);
  },
  run: async ({ prepared, principal, tx, audit }) => {
    if (!(await tx.vaultKeyring.findUnique({ where: { id: "default" }, select: { id: true } }))) fail("conflict", "vault.errors.notSetUp");
    await replacePassphrase(tx, prepared, principal.user.name);
    audit({ target: "–", entityId: "default" });
    return { ok: true as const };
  },
});

/**
 * **Tresor zurücksetzen** (Passphrase und Wiederherstellungsschlüssel verloren): entfernt die Hüllen und die Zugangsdaten aller Einträge (die Einträge bleiben mit „Neu eingeben nötig“); die Zeilen werden vorher nach
 * `secret-reset/` gesichert. Verlangt die Passwortabfrage und eine ausdrückliche Bestätigung; endgültig.
 */
export const resetVaultOperation = defineOperation({
  name: "vault.reset",
  permission: "docs.vaultManage",
  input: z.object({ password: passwordField, confirm: z.preprocess((v) => v === true || v === "1" || v === "on" || v === "true", z.boolean()) }),
  audit: "vault.reset",
  prepare: async ({ input, principal }) => {
    if (!principal.can("docs.vault")) fail("forbidden");
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
    if (!input.confirm) failField("confirm", "vault.keyring.errors.confirmReset");
  },
  run: async ({ principal, tx, audit, afterCommit }) => {
    if (!(await tx.vaultKeyring.findUnique({ where: { id: "default" }, select: { id: true } }))) fail("conflict", "vault.errors.notSetUp");
    const { count, backup } = await resetVaultEntries(tx);
    await deleteKeyring(tx);
    audit({ target: `${count} ${count === 1 ? "Eintrag" : "Einträge"}${backup ? ` · Sicherung secret-reset/${backup}` : ""}`, entityId: "default" });
    afterCommit(() => lockVault());
    void principal;
    return { count };
  },
});
