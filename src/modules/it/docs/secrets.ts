import type { SecretConsumerDef } from "@/server/secret-consumers";
import { affectedVaultRows, resetUnreadableVaultEntries } from "./vault-reset";

/**
 * Die Eintragsschlüssel des IT-Tresors sind mit `secret.key` umhüllt. Nach einem Restore ohne passenden Schlüssel (und ohne Wiederherstellungsschlüssel) sind sie nicht lesbar: Die Einträge bleiben, ihre
 * Zugangsdaten werden – nach vorheriger Sicherung der Zeilen nach `<DATA_DIR>/secret-reset/` – entfernt und der Eintrag als „Neu eingeben nötig“ markiert (`vault-reset.ts`). Mit dem Wiederherstellungsschlüssel
 * bleibt der Tresor lesbar (er stellt `secret.key` wieder her), dann gibt es nichts zurückzusetzen.
 */
export const secretConsumers: SecretConsumerDef[] = [{ id: "it.vault", feature: "it.docs", resetUnreadable: resetUnreadableVaultEntries, affectedRows: affectedVaultRows }];
