import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { audit as writeAudit } from "@/server/audit";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { loginThrottle } from "@/server/auth/throttle";
import { defineOperation, fail } from "@/server/operations";
import { SecretKeyUnavailableError } from "@/server/secrets";
import { VAULT_KINDS, VAULT_LIMITS } from "./vault-constants";
import { EMPTY_SECRET, hasContent, openVaultEntry, sealVaultEntry, type VaultSecret } from "./vault-crypto";

/**
 * Operationen des IT-Tresors (F13). Festgelegt (Tests in `vault.test.ts`):
 *  - **Rechte:** Anzeigen braucht `docsIt.vault`, Anlegen/Ändern/Löschen zusätzlich `docsIt.vaultManage` (beide nur ausdrücklich, auch für Administratoren; `explicitOnly`), nie über die API.
 *  - **Anzeigen nur mit erneuter Passwortabfrage** der handelnden Person (`confirmOwnPassword` mit dem eigenen Limit `loginThrottle.vault`, Eigentümer-Pfad – nicht die scrypt-Semaphore der Anmeldung) und
 *    dem Mengenlimit `loginThrottle.vaultReveal`; Audit `vault.reveal` mit Eintrag-ID und Titel, **nie Inhalt**; ein falsches Passwort zählt, steht (gedrosselt) als `vault.revealFailed` im Audit-Log.
 *  - **Klartext nur in der Antwort der Aktion** (`state` des Adapters): nie URL, Log, Audit, Suche, API, Webhook, CSV.
 *  - **Ändern** verschlüsselt neu (neuer Eintragsschlüssel, neue IV, Revision + 1); leere Felder lassen die bisherigen Werte stehen (der Server liest sie dafür intern, ohne sie anzuzeigen), die „Entfernen“-Häkchen leeren
 *    ein Feld. Ist der Eintrag nicht lesbar (Wiederherstellung ohne Schlüssel), gilt nur die neue Eingabe („Neu eingeben“). Fehlt `secret.key`, scheitert alles laut (`keyUnavailable`).
 *  - **Löschen** ist endgültig (mit Rückfrage in der Oberfläche); Backups behalten den Stand von damals (verschlüsselt).
 */
const flag = z.preprocess((v) => v === true || v === "1" || v === "on" || v === "true", z.boolean());

const limited = (max: number) => z.string().max(max).optional();

const saveInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  title: z.string().trim().min(1).max(VAULT_LIMITS.title),
  kind: z.enum(VAULT_KINDS),
  system: z.string().trim().max(VAULT_LIMITS.system).optional(),
  url: limited(VAULT_LIMITS.url),
  username: limited(VAULT_LIMITS.username),
  secret: limited(VAULT_LIMITS.secret),
  note: limited(VAULT_LIMITS.note),
  clearUrl: flag.default(false),
  clearUsername: flag.default(false),
  clearSecret: flag.default(false),
  clearNote: flag.default(false),
});

export const saveVaultEntryOperation = defineOperation({
  name: "vault.save",
  permission: "docsIt.vaultManage",
  input: saveInput,
  audit: (input) => (input.id ? "vault.update" : "vault.create"),
  run: async ({ input, principal, tx, audit }) => {
    // Verwalten setzt das Ansehen voraus: wer nicht einmal die Liste sehen darf, ändert auch nichts „blind“
    if (!principal.can("docsIt.vault")) fail("forbidden");
    const typed: VaultSecret = { url: input.url?.trim() ?? "", username: input.username?.trim() ?? "", secret: input.secret ?? "", note: input.note ?? "" };
    const clear = { url: input.clearUrl, username: input.clearUsername, secret: input.clearSecret, note: input.clearNote };
    const credentialsChanged = hasContent(typed) || clear.url || clear.username || clear.secret || clear.note;
    const meta = { title: input.title, kind: input.kind, system: input.system || null, updatedByName: principal.user.name };
    try {
      let id = input.id;
      let revision = 1;
      let secret: VaultSecret = typed;
      if (id) {
        const existing = await tx.vaultEntry.findUnique({ where: { id }, select: { id: true, format: true, revision: true, wrappedKey: true, payload: true } });
        if (!existing) fail("notFound");
        if (!(await claimRow(tx.vaultEntry, id, input.version))) fail("conflict");
        // Keine Änderung an den Zugangsdaten: der verschlüsselte Block (und ein Vermerk „Neu eingeben nötig“) bleibt, wie er ist – dafür braucht es auch den Schlüssel nicht
        if (!credentialsChanged) {
          await tx.vaultEntry.update({ where: { id }, data: meta });
          audit({ target: input.title, entityId: id });
          return { id };
        }
        revision = existing.revision + 1;
        // Bisherige Werte behalten, was nicht neu eingegeben oder entfernt wird – gelesen wird intern, angezeigt nie
        const opened = openVaultEntry(existing);
        const base: VaultSecret = opened.ok ? opened.secret : EMPTY_SECRET;
        secret = {
          url: clear.url ? "" : typed.url || base.url,
          username: clear.username ? "" : typed.username || base.username,
          secret: clear.secret ? "" : typed.secret || base.secret,
          note: clear.note ? "" : typed.note || base.note,
        };
      } else {
        id = (await tx.vaultEntry.create({ data: { ...meta, createdByName: principal.user.name }, select: { id: true } })).id;
      }
      const sealed = hasContent(secret) ? sealVaultEntry(id, revision, secret) : null;
      await tx.vaultEntry.update({
        where: { id },
        data: { ...meta, revision, format: sealed?.format ?? 1, wrappedKey: sealed?.wrappedKey ?? null, payload: sealed?.payload ?? null, unreadableAt: null },
      });
      // Das Audit nennt den Eintrag und ob Zugangsdaten gesetzt wurden – nie ihren Inhalt
      audit({ target: credentialsChanged ? `${input.title} · Zugangsdaten` : input.title, entityId: id });
      return { id };
    } catch (error) {
      if (error instanceof SecretKeyUnavailableError) fail("conflict", "vault.errors.keyUnavailable");
      throw error;
    }
  },
});

export const deleteVaultEntryOperation = defineOperation({
  name: "vault.delete",
  permission: "docsIt.vaultManage",
  input: z.object({ id: z.string().min(1) }),
  audit: "vault.delete",
  run: async ({ input, principal, tx, audit }) => {
    if (!principal.can("docsIt.vault")) fail("forbidden");
    const entry = await tx.vaultEntry.findUnique({ where: { id: input.id }, select: { title: true } });
    if (!entry) fail("notFound");
    await tx.vaultEntry.delete({ where: { id: input.id } });
    audit({ target: entry.title, entityId: input.id });
    return { id: input.id };
  },
});

export type RevealedEntry = { title: string; url: string; username: string; secret: string; note: string };

export const revealVaultEntryOperation = defineOperation({
  name: "vault.reveal",
  permission: "docsIt.vault",
  input: z.object({ id: z.string().min(1), password: z.string().max(1024) }),
  audit: "vault.reveal",
  // Passwortprüfung außerhalb der Transaktion (aufwendig, eigener Pfad `ownerLane`); danach das Mengenlimit der Anzeigen
  prepare: async ({ input, principal }) => {
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
    const volume = loginThrottle.vaultReveal;
    const wait = volume.check(principal.user.id);
    if (wait > 0) fail("forbidden", "account.errors.tooManyAttempts", { seconds: Math.ceil(wait / 1000) });
    volume.take(principal.user.id);
  },
  onFailure: async ({ input, principal, failure }) => {
    // Nur ein falsches Passwort wird protokolliert (gedrosselt: je Konto höchstens einmal pro Minute) – nie, was eingegeben wurde
    if (failure?.fields?.password && loginThrottle.audit.allow(`vault:${principal.user.id}`)) {
      await writeAudit("vault.revealFailed", { actor: { id: principal.user.id, name: principal.user.name }, target: "–", entityId: input.id });
    }
  },
  run: async ({ input, tx, audit }): Promise<RevealedEntry> => {
    const entry = await tx.vaultEntry.findUnique({ where: { id: input.id }, select: { id: true, title: true, format: true, revision: true, wrappedKey: true, payload: true } });
    if (!entry) fail("notFound");
    let opened;
    try {
      opened = openVaultEntry(entry);
    } catch (error) {
      if (error instanceof SecretKeyUnavailableError) fail("conflict", "vault.errors.keyUnavailable");
      throw error;
    }
    if (!opened.ok) {
      fail("conflict", opened.reason === "empty" ? "vault.errors.empty" : opened.reason === "unreadable" ? "vault.errors.unreadable" : "vault.errors.damaged");
    }
    // Eintrag-ID und Titel, nie Inhalt
    audit({ target: entry.title, entityId: entry.id });
    return { title: entry.title, ...opened.secret };
  },
});
