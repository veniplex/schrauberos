import "server-only";
import { db } from "@/server/db";
import { SecretKeyUnavailableError } from "@/server/secrets";
import { VAULT_FORMAT, openVaultEntry } from "./vault-crypto";

/**
 * Verbraucher `it.vault` des Geheimnis-Registers (`secrets.ts` der Funktion): Nach einem Restore ohne passenden `secret.key` lassen sich die Eintragsschlüssel nicht mehr öffnen. Zurückgesetzt wird **nur**, was
 * der Schlüssel **dieses Datenträgers** wirklich nicht öffnet – `unreadable`: der Block ist gut geformt, aber der Eintragsschlüssel geht mit diesem Schlüssel nicht auf (fremder Schlüssel). Ein Eintrag, den er
 * öffnet, bleibt unberührt, und **ein Eintrag in einem Format, das dieses Programm nicht kennt (`unsupported`: neuere Version nach einem Rückfall beim Web-Update, abgesenkte Feldgrenzen) oder ein beschädigter
 * Block (`damaged`) wird nie automatisch zurückgesetzt** – das wäre Datenverlust ohne Zutun der Administration; beides wird nur gemeldet (Protokoll: Anzahl, nie Inhalt). `secret-reset.ts` ruft das nur bei lesbarem
 * Schlüssel und sichert **vorher** die betroffenen Zeilen (`affectedVaultRows`: nur verschlüsselte Blöcke und Titel, kein Klartext) nach `<DATA_DIR>/secret-reset/`. Zurückgesetzt heißt: Eintragsschlüssel und
 * Block werden entfernt und der Eintrag als „Neu eingeben nötig“ markiert (`unreadableAt`) – Titel, Art und System bleiben. Nie stilles Löschen eines Eintrags.
 */
async function classify() {
  const rows = await db.vaultEntry.findMany({
    where: { wrappedKey: { not: null } },
    select: { id: true, title: true, kind: true, system: true, format: true, revision: true, wrappedKey: true, payload: true, createdAt: true, updatedAt: true },
  });
  const unreadable: typeof rows = [];
  let damaged = 0;
  let unsupported = 0;
  for (const row of rows) {
    try {
      const opened = openVaultEntry(row);
      if (opened.ok || opened.reason === "empty") continue;
      if (opened.reason === "unreadable") unreadable.push(row);
      else if (opened.reason === "unsupported") unsupported++;
      else damaged++;
    } catch (error) {
      // Schlüssel nicht lesbar: nichts ist „fremd“, nur gerade nicht erreichbar – dann wird nie zurückgesetzt
      if (error instanceof SecretKeyUnavailableError) throw error;
      damaged++;
    }
  }
  return { unreadable, damaged, unsupported };
}

/** Anzahl der Einträge mit hinterlegten Zugangsdaten (für den Hinweis „Tresor betroffen“ im Audit-Log bei Schlüsselvorgängen; liest nur zählend) */
export const vaultEntryCount = (): Promise<number> => db.vaultEntry.count({ where: { wrappedKey: { not: null } } });

/** Die Zeilen, die ein Zurücksetzen anfassen würde (nur `unreadable`) – für die Sicherung vor dem Zurücksetzen. Fehler werden nicht verschluckt (`secret-reset.ts` setzt dann für diesen Verbraucher nichts zurück). */
export async function affectedVaultRows(): Promise<Array<Record<string, unknown>>> {
  return (await classify()).unreadable.map((row) => ({ ...row }));
}

export async function resetUnreadableVaultEntries(): Promise<number> {
  const { unreadable, damaged, unsupported } = await classify();
  // Nicht zurückgesetzt, nur gemeldet: nie Inhalt oder Titel im Protokoll
  if (damaged > 0 || unsupported > 0) {
    console.error(`[secrets] it.vault: ${damaged} beschädigte und ${unsupported} nicht unterstützte Einträge wurden NICHT zurückgesetzt (Sicherung der Datenbank prüfen, ggf. neuere Programmversion).`);
  }
  const now = new Date();
  for (const row of unreadable) await db.vaultEntry.updateMany({ where: { id: row.id, wrappedKey: row.wrappedKey }, data: { wrappedKey: null, payload: null, format: VAULT_FORMAT, unreadableAt: now } });
  return unreadable.length;
}
