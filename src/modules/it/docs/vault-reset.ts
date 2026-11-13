import "server-only";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/updates/store";
import { db } from "@/server/db";
import { VAULT_FORMAT } from "./vault-crypto";

/**
 * Verbraucher `it.vault` des Geheimnis-Registers (`secrets.ts` der Funktion). **Der Tresor hängt nicht mehr an `secret.key`** (Schlüsselkonzept: Hauptschlüssel aus der Tresor-Passphrase, nur im Speicher; README
 * „IT-Tresor“): Ein Restore ohne passenden Schlüssel berührt ihn nicht. Der Tresor bleibt nach dem Neustart **gesperrt**, seine Einträge bleiben unverändert lesbar mit der Passphrase oder dem Wiederherstellungsschlüssel.
 * Darum gibt es hier **nichts automatisch zurückzusetzen** – `resetUnreadable` und `affectedRows` melden null bzw. keine Zeilen. (Zurückgesetzt wird der Tresor nur **ausdrücklich** durch „Tresor zurücksetzen“, wenn
 * Passphrase und Wiederherstellungsschlüssel verloren sind: `resetVaultEntries`, mit Sicherung der Zeilen.)
 */

/** Anzahl der Einträge mit hinterlegten Zugangsdaten (für den Hinweis „Tresor betroffen“ im Audit-Log bei Schlüsselvorgängen, die den Tresor betreffen können; liest nur zählend) */
export const vaultEntryCount = (): Promise<number> => db.vaultEntry.count({ where: { wrappedKey: { not: null } } });

/** Nichts zurückzusetzen: der Tresor hängt nicht an `secret.key` (siehe oben). */
export const resetUnreadableVaultEntries = async (): Promise<number> => 0;

/** Keine Zeilen: nichts wird automatisch angefasst. */
export const affectedVaultRows = async (): Promise<Array<Record<string, unknown>>> => [];

/**
 * **Ausdrückliches Zurücksetzen des Tresors** (Passphrase und Wiederherstellungsschlüssel verloren): sichert zuerst die betroffenen Zeilen (nur verschlüsselte Blöcke und Beschriftungen, kein Klartext) als Datei
 * `secret-reset/vault-<Zeit>.json` (Rechte 0600, nie überschrieben, nicht im Backup) und entfernt dann Eintragsschlüssel und Blöcke; die Einträge selbst bleiben („Neu eingeben nötig“, `unreadableAt`).
 * Aufruf nur aus der Operation `vault.reset`, in deren Transaktion `tx` läuft. Liefert Anzahl und Dateiname der Sicherung.
 */
export async function resetVaultEntries(tx: Pick<typeof db, "vaultEntry">, now = new Date()): Promise<{ count: number; backup: string | null }> {
  const rows = await tx.vaultEntry.findMany({ where: { wrappedKey: { not: null } }, select: { id: true, title: true, kind: true, system: true, format: true, revision: true, wrappedKey: true, payload: true, createdAt: true, updatedAt: true } });
  let backup: string | null = null;
  if (rows.length > 0) {
    const dir = path.join(/*turbopackIgnore: true*/ dataDir(), "secret-reset");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    backup = `vault-${now.toISOString().replace(/[-:]/g, "").replace(/\..*/, "")}Z-${randomBytes(3).toString("hex")}.json`;
    const file = path.join(dir, backup);
    writeFileSync(file, JSON.stringify({ version: 1, at: now.toISOString(), reason: "Tresor ausdrücklich zurückgesetzt", note: "Nur verschlüsselte Blöcke (kein Klartext); sie gehören zum bisherigen Tresor-Hauptschlüssel.", entries: rows }, null, 2), { mode: 0o600, flag: "wx" });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* Dateisysteme ohne Modi */
    }
  }
  for (const row of rows) await tx.vaultEntry.updateMany({ where: { id: row.id, wrappedKey: row.wrappedKey }, data: { wrappedKey: null, payload: null, format: VAULT_FORMAT, unreadableAt: now } });
  return { count: rows.length, backup };
}
