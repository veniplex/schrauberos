import "server-only";
import { db } from "@/server/db";
import { SecretKeyUnavailableError } from "@/server/secrets";
import { VAULT_FORMAT, openVaultEntry } from "./vault-crypto";

/**
 * Verbraucher `it.vault` des Geheimnis-Registers (`secrets.ts` der Funktion): Nach einem Restore ohne passenden `secret.key` lassen sich die Eintragsschlüssel nicht mehr öffnen. Zurückgesetzt wird nur, was
 * der Schlüssel **dieses Datenträgers** wirklich nicht öffnet (`unreadable`: fremder Schlüssel, oder `damaged`: verändert) – ein Eintrag, den er öffnet, bleibt unberührt. `secret-reset.ts` ruft das nur bei
 * lesbarem Schlüssel und sichert **vorher** die betroffenen Zeilen (`affectedVaultRows`: nur verschlüsselte Blöcke und Titel, kein Klartext) nach `<DATA_DIR>/secret-reset/`. Zurückgesetzt heißt: Eintragsschlüssel und
 * Block werden entfernt und der Eintrag als „Neu eingeben nötig“ markiert (`unreadableAt`) – Titel, Art und System bleiben. Nie stilles Löschen eines Eintrags.
 */
async function unreadableEntries() {
  const rows = await db.vaultEntry.findMany({ where: { wrappedKey: { not: null } }, select: { id: true, title: true, kind: true, system: true, format: true, revision: true, wrappedKey: true, payload: true, createdAt: true, updatedAt: true } });
  const bad = rows.filter((row) => {
    try {
      const opened = openVaultEntry(row);
      return !opened.ok && opened.reason !== "empty";
    } catch (error) {
      // Schlüssel nicht lesbar: nichts ist „fremd“, nur gerade nicht erreichbar – dann wird nie zurückgesetzt
      if (error instanceof SecretKeyUnavailableError) throw error;
      return true;
    }
  });
  return bad;
}

export async function affectedVaultRows(): Promise<Array<Record<string, unknown>>> {
  return (await unreadableEntries()).map((row) => ({ ...row }));
}

export async function resetUnreadableVaultEntries(): Promise<number> {
  const bad = await unreadableEntries();
  const now = new Date();
  for (const row of bad) await db.vaultEntry.updateMany({ where: { id: row.id, wrappedKey: row.wrappedKey }, data: { wrappedKey: null, payload: null, format: VAULT_FORMAT, unreadableAt: now } });
  return bad.length;
}
