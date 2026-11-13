"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { changeVaultPassphraseOperation, lockVaultOperation, resetVaultOperation, setupVaultOperation, unlockVaultOperation, unlockVaultWithRecoveryKeyOperation } from "./vault-keyring-operations";
import { deleteVaultEntryOperation, revealVaultEntryOperation, saveVaultEntryOperation } from "./vault-operations";

const PATHS = ["/docs/vault", "/"];

/** Der erste nichtleere Wert unter einem der Feldnamen (die Felder heißen `vault_*`, damit Passwortmanager sie nicht als Anmeldedaten deuten; die alten Namen gelten weiter, z. B. für Aufrufe ohne Formular) */
const pick = (fd: FormData, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = fd.get(name);
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
};

export const saveVaultEntry = defineAction(saveVaultEntryOperation, {
  form: (fd) => ({
    ...formObject(fd),
    url: pick(fd, "vault_url", "url")?.trim(),
    username: pick(fd, "vault_account", "username")?.trim(),
    // Zugangsdaten nie kürzen oder umformen (formObject trimmt): Geheimnis, Notiz und Passwort kommen unverändert
    secret: pick(fd, "vault_secret", "secret"),
    note: pick(fd, "vault_note", "note"),
    password: pick(fd, "password"),
    clearUrl: fd.get("clearUrl") === "on",
    clearUsername: fd.get("clearUsername") === "on",
    clearSecret: fd.get("clearSecret") === "on",
    clearNote: fd.get("clearNote") === "on",
  }),
  revalidate: ({ id }) => [...PATHS, `/docs/vault/${id}`],
  redirect: ({ id }) => `/docs/vault/${id}`,
});

/** Löschen verlangt das eigene Passwort (unverändert, nicht gekürzt); ein Fehler (falsches Passwort) bleibt auf der Seite des Eintrags. */
export const deleteVaultEntry = defineAction(deleteVaultEntryOperation, {
  form: (fd) => ({ id: String(fd.get("id") ?? ""), password: pick(fd, "password") }),
  revalidate: PATHS,
  redirect: "/docs/vault",
  message: "common.deleted",
  redirectOnError: (fd) => `/docs/vault/${String(fd.get("id") ?? "")}`,
});

/** Anzeigen: Passwortabfrage, danach steht der Klartext **nur in der Antwort dieser Aktion** (`vault`) – nie in URL, Log, Audit oder Datenbank. */
export const revealVaultEntry = defineAction(revealVaultEntryOperation, {
  form: (fd) => ({ id: String(fd.get("id") ?? ""), password: String(fd.get("password") ?? "") }),
  state: (data) => ({ vault: data }),
});

/* ───────────── Tresor-Hülle: einrichten, entsperren, sperren, Passphrase ändern, zurücksetzen ───────────── */

const text = (fd: FormData, name: string) => String(fd.get(name) ?? ""); // Passphrase und Passwort nie kürzen oder umformen

export const setupVault = defineAction(setupVaultOperation, {
  form: (fd) => ({ passphrase: text(fd, "vault_passphrase"), confirm: text(fd, "vault_passphrase_confirm"), password: text(fd, "password") }),
  revalidate: [...PATHS, ["/", "layout"]],
  message: "vault.keyring.messages.setupDone",
});
export const unlockVault = defineAction(unlockVaultOperation, {
  form: (fd) => ({ passphrase: text(fd, "vault_passphrase"), password: text(fd, "password") }),
  revalidate: [...PATHS, ["/", "layout"]],
  message: "vault.keyring.messages.unlocked",
});
export const unlockVaultWithRecoveryKey = defineAction(unlockVaultWithRecoveryKeyOperation, {
  form: (fd) => ({ recoveryKey: text(fd, "vault_recovery_key"), password: text(fd, "password") }),
  revalidate: [...PATHS, ["/", "layout"]],
  message: "vault.keyring.messages.unlocked",
});
export const lockVault = defineAction(lockVaultOperation, { revalidate: [...PATHS, ["/", "layout"]], message: "vault.keyring.messages.locked" });
export const changeVaultPassphrase = defineAction(changeVaultPassphraseOperation, {
  form: (fd) => ({ passphrase: text(fd, "vault_passphrase"), confirm: text(fd, "vault_passphrase_confirm"), password: text(fd, "password") }),
  revalidate: PATHS,
  message: "vault.keyring.messages.changed",
});
export const resetVault = defineAction(resetVaultOperation, {
  form: (fd) => ({ password: text(fd, "password"), confirm: fd.get("confirm") === "on" }),
  revalidate: [...PATHS, ["/", "layout"]],
  message: "vault.keyring.messages.resetDone",
});
