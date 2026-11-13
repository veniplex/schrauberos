import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { audit as writeAudit } from "@/server/audit";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { loginThrottle } from "@/server/auth/throttle";
import { db } from "@/server/db";
import { defineOperation, fail, failField } from "@/server/operations";
import { VaultLockedError, vaultStatus } from "@/server/vault-keyring";
import { VAULT_KINDS, VAULT_LIMITS } from "./vault-constants";
import { EMPTY_SECRET, hasContent, openVaultEntry, sealVaultEntry, type VaultLabel, type VaultSecret } from "./vault-crypto";

/**
 * Operationen des IT-Tresors (F13). Festgelegt (Tests in `vault.test.ts`):
 *  - **Rechte:** Anzeigen braucht `docsIt.vault`, Anlegen/Ändern/Löschen zusätzlich `docsIt.vaultManage` (beide nur ausdrücklich, auch für Administratoren; `explicitOnly`), nie über die API.
 *  - **Anzeigen nur mit erneuter Passwortabfrage** der handelnden Person (`confirmOwnPassword` mit dem eigenen Limit `loginThrottle.vault`, Eigentümer-Pfad – nicht die scrypt-Semaphore der Anmeldung) und
 *    dem Mengenlimit `loginThrottle.vaultReveal`; Audit `vault.reveal` mit Eintrag-ID und Titel, **nie Inhalt**; ein falsches Passwort zählt, steht (gedrosselt) als `vault.revealFailed` im Audit-Log.
 *  - **Löschen und Ändern der hinterlegten Zugangsdaten eines bestehenden Eintrags** (ersetzen, ergänzen, entfernen) verlangen dieselbe Passwortabfrage mit demselben Limit: eine unbeaufsichtigte Sitzung darf den
 *    Tresor weder leeren noch Zugangsdaten gegen eigene tauschen. Anlegen, erstmaliges Eintragen, Umbenennen und Ändern der Beschriftung nicht.
 *  - **Klartext nur in der Antwort der Aktion** (`state` des Adapters): nie URL, Log, Audit, Suche, API, Webhook, CSV.
 *  - **Ändern** verschlüsselt neu (neuer Eintragsschlüssel, neue IV, Revision + 1); leere Felder lassen die bisherigen Werte stehen (der Server liest sie dafür intern, ohne sie anzuzeigen), die „Entfernen“-Häkchen leeren
 *    ein Feld. Titel, Art und System sind mit dem Block verbunden (AAD, `vault-crypto.ts`): ändert sich eine der Angaben, wird der Block mit neu verschlüsselt – dazu muss er lesbar sein.
 *  - **Gesperrter Tresor = nichts geht:** Solange der Tresor nicht eingerichtet (`vault.errors.notSetUp`) oder gesperrt ist (`vault.errors.locked`, nach jedem Neustart bis zur Eingabe der Passphrase), werden weder
 *    Zugangsdaten gelesen noch geschrieben noch ein Block angefasst – Einträge ohne Zugangsdaten lassen sich anlegen und umbenennen. **Ändern überschreibt nie einen unbekannten Block:** Ein Block in unbekanntem Format
 *    (`unsupported`, neuere Version) wird nie überschrieben; ein beschädigter Block lässt sich nur durch eine **vollständige Neueingabe** aller vier Felder ersetzen.
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
  /** Passwort der handelnden Person: nötig, wenn die Zugangsdaten eines bestehenden Eintrags geändert werden */
  password: z.string().max(1024).optional(),
});
type SaveInput = z.infer<typeof saveInput>;

const typedOf = (input: SaveInput): VaultSecret => ({ url: input.url?.trim() ?? "", username: input.username?.trim() ?? "", secret: input.secret ?? "", note: input.note ?? "" });
const clearOf = (input: SaveInput) => ({ url: input.clearUrl, username: input.clearUsername, secret: input.clearSecret, note: input.clearNote });
const touchesCredentials = (input: SaveInput): boolean => {
  const clear = clearOf(input);
  return hasContent(typedOf(input)) || clear.url || clear.username || clear.secret || clear.note;
};

export const saveVaultEntryOperation = defineOperation({
  name: "vault.save",
  permission: "docsIt.vaultManage",
  input: saveInput,
  audit: (input) => (input.id ? "vault.update" : "vault.create"),
  // Zugangsdaten eines bestehenden Eintrags **mit hinterlegten Zugangsdaten** ändern, ersetzen oder entfernen: erneute Passwortabfrage (außerhalb der Transaktion; aufwendig, eigener Pfad `ownerLane`, eigenes
  // Limit). Erstmaliges Eintragen in einen Eintrag ohne Zugangsdaten (neu angelegt, „Neu eingeben nötig“) ersetzt nichts und braucht sie nicht.
  prepare: async ({ input, principal }) => {
    if (!input.id || !touchesCredentials(input)) return;
    const current = await db.vaultEntry.findUnique({ where: { id: input.id }, select: { wrappedKey: true, payload: true } });
    if (!current || (!current.wrappedKey && !current.payload)) return;
    if (!input.password) failField("password", "validation.required");
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
  },
  run: async ({ input, principal, tx, audit }) => {
    // Verwalten setzt das Ansehen voraus: wer nicht einmal die Liste sehen darf, ändert auch nichts „blind“
    if (!principal.can("docsIt.vault")) fail("forbidden");
    const typed = typedOf(input);
    const clear = clearOf(input);
    const credentialsChanged = touchesCredentials(input);
    const label: VaultLabel = { title: input.title, kind: input.kind, system: input.system || null };
    const meta = { ...label, updatedByName: principal.user.name };
    try {
      let id = input.id;
      let revision = 1;
      let secret: VaultSecret = typed;
      if (id) {
        const existing = await tx.vaultEntry.findUnique({ where: { id }, select: { id: true, title: true, kind: true, system: true, format: true, revision: true, wrappedKey: true, payload: true } });
        if (!existing) fail("notFound");
        if (!(await claimRow(tx.vaultEntry, id, input.version))) fail("conflict");
        const hasBlock = Boolean(existing.wrappedKey || existing.payload);
        const labelChanged = existing.title !== label.title || existing.kind !== label.kind || existing.system !== label.system;
        // Nichts zu verschlüsseln oder neu zu verschlüsseln: nur die Beschriftung (kein Block) bzw. nichts (der Block bleibt, wie er ist – dafür braucht es auch den Schlüssel nicht)
        if (!credentialsChanged && (!hasBlock || !labelChanged)) {
          await tx.vaultEntry.update({ where: { id }, data: meta });
          audit({ target: input.title, entityId: id });
          return { id };
        }
        revision = existing.revision + 1;
        // Bisherige Werte behalten, was nicht neu eingegeben oder entfernt wird – gelesen wird intern, angezeigt nie
        let base: VaultSecret = EMPTY_SECRET;
        if (hasBlock) {
          const opened = openVaultEntry(existing);
          if (opened.ok) {
            base = opened.secret;
          } else if (opened.reason !== "empty") {
            // Der Block ist da, lässt sich aber nicht lesen: nie still überschreiben
            if (opened.reason === "unsupported") fail("conflict", "vault.errors.unsupported");
            // beschädigt: nur eine vollständige Neueingabe ersetzt ihn
            const complete = (["url", "username", "secret", "note"] as const).every((field) => clear[field] || typed[field] !== "");
            if (!credentialsChanged || !complete) fail("conflict", "vault.errors.replaceAll");
          }
        }
        secret = {
          url: clear.url ? "" : typed.url || base.url,
          username: clear.username ? "" : typed.username || base.username,
          secret: clear.secret ? "" : typed.secret || base.secret,
          note: clear.note ? "" : typed.note || base.note,
        };
      } else {
        id = (await tx.vaultEntry.create({ data: { ...meta, createdByName: principal.user.name }, select: { id: true } })).id;
      }
      // Zugangsdaten schreiben nur bei entsperrtem Tresor (nicht eingerichtet oder gesperrt: nichts wird verschlüsselt, nichts geht verloren)
      if (hasContent(secret)) {
        const status = (await vaultStatus(tx)).state;
        if (status === "notSetUp") fail("conflict", "vault.errors.notSetUp");
        if (status === "locked") fail("conflict", "vault.errors.locked");
      }
      const sealed = hasContent(secret) ? sealVaultEntry(id, revision, label, secret) : null;
      await tx.vaultEntry.update({
        where: { id },
        data: { ...meta, revision, format: sealed?.format ?? 1, wrappedKey: sealed?.wrappedKey ?? null, payload: sealed?.payload ?? null, unreadableAt: null },
      });
      // Das Audit nennt den Eintrag und ob Zugangsdaten gesetzt wurden – nie ihren Inhalt
      audit({ target: credentialsChanged ? `${input.title} · Zugangsdaten` : input.title, entityId: id });
      return { id };
    } catch (error) {
      if (error instanceof VaultLockedError) fail("conflict", "vault.errors.locked");
      throw error;
    }
  },
});

export const deleteVaultEntryOperation = defineOperation({
  name: "vault.delete",
  permission: "docsIt.vaultManage",
  input: z.object({ id: z.string().min(1), password: z.string().max(1024).optional() }),
  audit: "vault.delete",
  // Löschen ist endgültig: wie das Anzeigen nur mit erneuter Passwortabfrage und demselben Limit
  prepare: async ({ input, principal }) => {
    if (!input.password) failField("password", "validation.required");
    await confirmOwnPassword(principal.user.id, input.password, "password", loginThrottle.vault);
  },
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

const REVEAL_ERRORS = { empty: "vault.errors.empty", unsupported: "vault.errors.unsupported", damaged: "vault.errors.damaged" } as const;

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
    const entry = await tx.vaultEntry.findUnique({ where: { id: input.id }, select: { id: true, title: true, kind: true, system: true, format: true, revision: true, wrappedKey: true, payload: true } });
    if (!entry) fail("notFound");
    let opened;
    try {
      opened = openVaultEntry(entry);
    } catch (error) {
      if (error instanceof VaultLockedError) fail("conflict", "vault.errors.locked");
      throw error;
    }
    if (!opened.ok) fail("conflict", REVEAL_ERRORS[opened.reason]);
    // Eintrag-ID und Titel, nie Inhalt
    audit({ target: entry.title, entityId: entry.id });
    return { title: entry.title, ...opened.secret };
  },
});
