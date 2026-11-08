"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { deleteVaultEntryOperation, revealVaultEntryOperation, saveVaultEntryOperation } from "./vault-operations";

const PATHS = ["/docs/vault", "/"];

export const saveVaultEntry = defineAction(saveVaultEntryOperation, {
  form: (fd) => ({
    ...formObject(fd),
    // Zugangsdaten nie kürzen oder umformen (formObject trimmt): Geheimnis und Notiz kommen unverändert
    secret: typeof fd.get("secret") === "string" && fd.get("secret") !== "" ? String(fd.get("secret")) : undefined,
    note: typeof fd.get("note") === "string" && fd.get("note") !== "" ? String(fd.get("note")) : undefined,
    clearUrl: fd.get("clearUrl") === "on",
    clearUsername: fd.get("clearUsername") === "on",
    clearSecret: fd.get("clearSecret") === "on",
    clearNote: fd.get("clearNote") === "on",
  }),
  revalidate: ({ id }) => [...PATHS, `/docs/vault/${id}`],
  redirect: ({ id }) => `/docs/vault/${id}`,
});

export const deleteVaultEntry = defineAction(deleteVaultEntryOperation, { revalidate: PATHS, redirect: "/docs/vault", message: "common.deleted" });

/** Anzeigen: Passwortabfrage, danach steht der Klartext **nur in der Antwort dieser Aktion** (`vault`) – nie in URL, Log, Audit oder Datenbank. */
export const revealVaultEntry = defineAction(revealVaultEntryOperation, {
  form: (fd) => ({ id: String(fd.get("id") ?? ""), password: String(fd.get("password") ?? "") }),
  state: (data) => ({ vault: data }),
});
