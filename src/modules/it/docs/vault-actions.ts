"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
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
