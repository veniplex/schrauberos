import { z } from "zod";
import { passphraseProblem } from "@/lib/vault-keys";
import { audit as writeAudit } from "@/server/audit";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { loginThrottle } from "@/server/auth/throttle";
import { db } from "@/server/db";
import { defineOperation, fail, failField } from "@/server/operations";
import { isCurrentRecoveryKey, recoveryKeyStatus } from "@/server/recovery-key";
import { throttledRecoveryKey } from "@/server/recovery-key-input";
import {
  buildKeyring,
  buildPassphraseWrap,
  createKeyring,
  deleteKeyring,
  lockVault,
  masterIsCurrent,
  openWithPassphrase,
  openWithRecoveryKey,
  replacePassphrase,
  unlockVaultIfCurrent,
  VaultLockedError,
  vaultStatus,
  wrapVaultForRecovery,
  type PassphraseOpen,
} from "@/server/vault-keyring";
import { discardResetBackups, resetVaultEntries } from "./vault-reset";

/**
 * Operationen der **Tresor-Hülle** (Schlüsselkonzept, README „IT-Tresor“): einrichten, entsperren (Passphrase oder Wiederherstellungsschlüssel), sperren, Passphrase ändern, Hülle für den Wiederherstellungsschlüssel
 * anlegen, zurücksetzen. Festgelegt (Tests in `vault-keyring.test.ts`):
 *  - **Rechte:** Einrichten, Passphrase ändern, Hülle anlegen und Zurücksetzen verlangen `docs.vaultManage` (und `docs.vault`), Entsperren und Sperren `docs.vault` – beide nur ausdrücklich (`explicitOnly`, auch Administratoren), nie über die API.
 *  - **Passwortabfrage der handelnden Person** (`confirmOwnPassword`, Eigentümer-Pfad, Limit `loginThrottle.vault`) bei jedem Vorgang außer dem Sperren – wer eine entsperrte Sitzung stiehlt, schaltet den Tresor nicht um.
 *  - **Passphrase falsch:** global gedrosselt (`loginThrottle.vaultKey`: 5 freie Versuche, dann 5 s … 90 s – für alle Konten gemeinsam), jeder Fehlversuch steht (höchstens einmal pro Minute) als `vault.unlockFailed` im Audit-Log, nie das Eingegebene.
 *    Die scrypt-Ableitung läuft im Eigentümer-Pfad (`ownerLane`), vor der Transaktion (`prepare`).
 *  - **Passphrase ändern verlangt die aktuelle Passphrase** (oder den Wiederherstellungsschlüssel, wenn sie vergessen ist) – Entsperrt-Sein allein genügt nicht: eine zweite Person an einer entsperrten Sitzung (oder eine gestohlene
 *    Sitzung samt Kontopasswort) kann die Passphrase nicht still umsetzen und die anderen aussperren. Gezählt wird auf demselben Limit wie das Entsperren (`vaultKey`, bzw. `recoveryKey`).
 *  - **Nie einen veralteten Schlüssel verwenden:** Der Hauptschlüssel, um den eine neue Hülle gebaut oder der entsperrt wird, wird in der Transaktion gegen den Prüfwert der Zeile gehalten (`masterIsCurrent`); ein
 *    zwischenzeitlich gesperrter, zurückgesetzter oder neu eingerichteter Tresor führt zu `conflict` statt zu einer Hülle um den falschen Schlüssel. Nach dem Commit wird der Schlüssel nur gesetzt, wenn er noch zur Zeile passt.
 *  - **Jede Entsperrung, Sperrung, Einrichtung, Passphrase-Änderung und jedes Zurücksetzen steht im Audit-Log** (nie Passphrase oder Schlüssel). Der Hauptschlüssel wird erst **nach dem Commit** in den Speicher gelegt.
 *  - **Nie stillschweigend zurücksetzen:** Passphrase vergessen heißt Wiederherstellungsschlüssel; erst wenn beides fehlt, setzt „Tresor zurücksetzen“ (ausdrücklich, mit Sicherung der Zeilen und der Hüllen) die Zugangsdaten zurück.
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

/** Die Passphrase gegen die Hülle prüfen (gedrosselt, global) und den Hauptschlüssel öffnen; Fehler als Fachfehler. Eine Zeile anderer Fassung zählt nicht als Fehlversuch. */
async function openCheckedPassphrase(passphrase: string, userId: string, field: string): Promise<Buffer> {
  takeAttempt();
  const opened: PassphraseOpen = await openWithPassphrase(db, passphrase, userId);
  if (!opened.ok) {
    if (opened.reason === "notSetUp") fail("conflict", "vault.errors.notSetUp");
    if (opened.reason === "unsupported") {
      loginThrottle.vaultKey.forgive("vault");
      fail("conflict", "vault.keyring.errors.unsupported");
    }
    if (opened.reason === "invalid") fail("conflict", "vault.keyring.errors.invalid");
    failField(field, "vault.keyring.errors.wrong");
  }
  loginThrottle.vaultKey.succeed("vault");
  return opened.master;
}

/** Den Wiederherstellungsschlüssel gegen die Hülle des Tresors prüfen (global gedrosselt, verlangsamt statt abzuweisen) und den Hauptschlüssel öffnen; Fehler als Fachfehler. */
async function openCheckedRecoveryKey(text: string, field: string): Promise<Buffer> {
  const entered = await throttledRecoveryKey(text);
  if (!entered.ok) failField(field, "vault.keyring.errors.recoveryFormat");
  try {
    const status = await vaultStatus(db);
    if (status.state === "notSetUp") fail("conflict", "vault.errors.notSetUp");
    if (!status.recovery) fail("conflict", "vault.keyring.errors.noRecoveryWrap");
    const opened = await openWithRecoveryKey(db, entered.key);
    if (!opened.ok) {
      if (opened.reason === "none") fail("conflict", "vault.keyring.errors.noRecoveryWrap");
      if (opened.reason === "unsupported") fail("conflict", "vault.keyring.errors.unsupported");
      if (opened.reason === "invalid") fail("conflict", "vault.keyring.errors.invalid");
      failField(field, "vault.keyring.errors.recoveryWrong");
    }
    entered.accept();
    return opened.master;
  } finally {
    entered.key.fill(0);
  }
}

const keyringOf = async () => db.vaultKeyring.findUnique({ where: { id: "default" }, select: { id: true } });

/** Der Hauptschlüssel passt in der Transaktion nicht (mehr) zur Zeile: der Tresor wurde währenddessen gesperrt, zurückgesetzt oder neu eingerichtet. */
const staleMaster = (): never => fail("conflict", "vault.keyring.errors.stale");

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
    afterCommit(async () => {
      await unlockVaultIfCurrent(db, prepared.master, principal.user.name);
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
    return { master: await openCheckedPassphrase(input.passphrase, principal.user.id, "passphrase") };
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
  run: async ({ prepared, principal, tx, audit, afterCommit }) => {
    if (!(await masterIsCurrent(tx, prepared.master))) staleMaster();
    audit({ target: "Passphrase", entityId: "default" });
    afterCommit(async () => {
      await unlockVaultIfCurrent(db, prepared.master, principal.user.name);
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
    return { master: await openCheckedRecoveryKey(input.recoveryKey, "recoveryKey") };
  },
  finish: (prepared, ok) => {
    if (!ok) prepared?.master.fill(0);
  },
  onFailure: async ({ principal, failure }) => {
    if (failure?.fields?.recoveryKey && loginThrottle.audit.allow("vault:recovery")) {
      await writeAudit("vault.unlockFailed", { actor: { id: principal.user.id, name: principal.user.name }, target: "Wiederherstellungsschlüssel", entityId: "default" });
    }
  },
  run: async ({ prepared, principal, tx, audit, afterCommit }) => {
    if (!(await masterIsCurrent(tx, prepared.master))) staleMaster();
    audit({ target: "Wiederherstellungsschlüssel", entityId: "default" });
    afterCommit(async () => {
      await unlockVaultIfCurrent(db, prepared.master, principal.user.name);
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

/**
 * Passphrase ändern: nur bei entsperrtem Tresor **und mit dem Nachweis der bisherigen Passphrase** (oder des Wiederherstellungsschlüssels, wenn sie vergessen ist); tauscht Hülle und Salz, die Einträge bleiben unberührt
 * (kein Neuverschlüsseln). Die neue Hülle wird um den **beim Nachweis geöffneten** Hauptschlüssel gebaut (eigene Kopie, nie der Puffer im Speicher); die Transaktion prüft ihn gegen den Prüfwert der Zeile.
 */
export const changeVaultPassphraseOperation = defineOperation({
  name: "vault.passphrase",
  permission: "docs.vaultManage",
  input: z.object({ current: passphraseField.default(""), recoveryKey: z.string().max(200).default(""), passphrase: passphraseField, confirm: passphraseField, password: passwordField }),
  audit: "vault.passphrase",
  prepare: async ({ input, principal }) => {
    if (!principal.can("docs.vault")) fail("forbidden");
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
    checkNewPassphrase(input.passphrase, input.confirm, principal.user.username);
    const status = await vaultStatus(db);
    if (status.state === "notSetUp") fail("conflict", "vault.errors.notSetUp");
    if (status.state === "locked") fail("conflict", "vault.errors.locked");
    if (!input.current && !input.recoveryKey) failField("current", "vault.keyring.errors.currentRequired");
    const master = input.current ? await openCheckedPassphrase(input.current, principal.user.id, "current") : await openCheckedRecoveryKey(input.recoveryKey, "recoveryKey");
    try {
      return { master, data: await buildPassphraseWrap(master, input.passphrase, principal.user.id) };
    } catch (error) {
      master.fill(0);
      throw error;
    }
  },
  finish: (prepared) => {
    prepared?.master.fill(0);
  },
  onFailure: async ({ principal, failure }) => {
    if ((failure?.fields?.current || failure?.fields?.recoveryKey) && loginThrottle.audit.allow("vault:passphrase")) {
      await writeAudit("vault.unlockFailed", { actor: { id: principal.user.id, name: principal.user.name }, target: failure.fields.current ? "Passphrase ändern" : "Wiederherstellungsschlüssel", entityId: "default" });
    }
  },
  run: async ({ prepared, principal, tx, audit }) => {
    if (!(await tx.vaultKeyring.findUnique({ where: { id: "default" }, select: { id: true } }))) fail("conflict", "vault.errors.notSetUp");
    if (!(await replacePassphrase(tx, prepared.data, prepared.master, principal.user.name))) staleMaster();
    audit({ target: "–", entityId: "default" });
    return { ok: true as const };
  },
});

/**
 * **Hülle für den Wiederherstellungsschlüssel anlegen** (bei entsperrtem Tresor): Wurde der Tresor eingerichtet, nachdem der Wiederherstellungsschlüssel erzeugt war, gibt es keine Hülle – der Schlüssel öffnet den Tresor
 * dann nicht. Hier gibt die berechtigte Person den (aktuellen, bei der Einrichtung gesicherten) Wiederherstellungsschlüssel ein; er wird gegen die gespeicherte Hülle von `secret.key` geprüft (ein falscher Schlüssel legte
 * eine Hülle an, die nie jemand öffnet) und der Hauptschlüssel wird darunter hinterlegt. Mit Passwortabfrage, auf dem globalen Limit des Wiederherstellungsschlüssels.
 */
export const addVaultRecoveryWrapOperation = defineOperation({
  name: "vault.recoveryWrap",
  permission: "docs.vaultManage",
  input: z.object({ recoveryKey: z.string().max(200), password: passwordField }),
  audit: "vault.recoveryWrap",
  prepare: async ({ input, principal }) => {
    if (!principal.can("docs.vault")) fail("forbidden");
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
    const status = await vaultStatus(db);
    if (status.state === "notSetUp") fail("conflict", "vault.errors.notSetUp");
    if (status.state === "locked") fail("conflict", "vault.errors.locked");
    if (!(await recoveryKeyStatus(db)).exists) fail("conflict", "vault.keyring.errors.noRecoveryKey");
    const entered = await throttledRecoveryKey(input.recoveryKey);
    if (!entered.ok) failField("recoveryKey", "vault.keyring.errors.recoveryFormat");
    if (!(await isCurrentRecoveryKey(db, entered.key))) {
      entered.key.fill(0);
      failField("recoveryKey", "vault.keyring.errors.recoveryNotCurrent");
    }
    entered.accept();
    return { key: entered.key };
  },
  finish: (prepared) => {
    prepared?.key.fill(0);
  },
  onFailure: async ({ principal, failure }) => {
    if (failure?.fields?.recoveryKey && loginThrottle.audit.allow("vault:recovery")) {
      await writeAudit("vault.unlockFailed", { actor: { id: principal.user.id, name: principal.user.name }, target: "Wiederherstellungsschlüssel hinterlegen", entityId: "default" });
    }
  },
  run: async ({ prepared, tx, audit }) => {
    try {
      await wrapVaultForRecovery(tx, prepared.key);
    } catch (error) {
      if (error instanceof VaultLockedError) fail("conflict", "vault.errors.locked");
      throw error;
    }
    audit({ target: "–", entityId: "default" });
    return { ok: true as const };
  },
});

/**
 * **Tresor zurücksetzen** (Passphrase und Wiederherstellungsschlüssel verloren): entfernt die Hüllen und die Zugangsdaten aller Einträge (die Einträge bleiben mit „Neu eingeben nötig“); die Zeilen **und die Hüllen** werden
 * vorher nach `secret-reset/` gesichert (die Datei entsteht in der Transaktion und wird bei einem Rollback sofort wieder entfernt). Verlangt die Passwortabfrage und eine ausdrückliche Bestätigung; endgültig.
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
    return { written: [] as string[] };
  },
  // Eine Sicherungsdatei, deren Transaktion zurückgerollt wurde, ist verwaist: sofort entfernen (bei Erfolg bleibt sie)
  finish: async (prepared, ok) => {
    if (!ok && prepared?.written.length) await discardResetBackups(prepared.written);
  },
  run: async ({ prepared, tx, audit, afterCommit }) => {
    if (!(await tx.vaultKeyring.findUnique({ where: { id: "default" }, select: { id: true } }))) fail("conflict", "vault.errors.notSetUp");
    const { count, backup } = await resetVaultEntries(tx);
    if (backup) prepared.written.push(backup);
    await deleteKeyring(tx);
    audit({ target: `${count} ${count === 1 ? "Eintrag" : "Einträge"}${backup ? ` · Sicherung secret-reset/${backup}` : ""}`, entityId: "default" });
    afterCommit(() => lockVault());
    return { count };
  },
});
