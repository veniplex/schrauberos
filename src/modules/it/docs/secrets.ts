import type { SecretConsumerDef } from "@/server/secret-consumers";
import { affectedVaultRows, resetUnreadableVaultEntries, vaultEntryCount } from "./vault-reset";

/**
 * Der IT-Tresor hängt **nicht** an `secret.key` (Hauptschlüssel aus der Tresor-Passphrase, nur im Speicher; `vault-reset.ts`): Ein Restore ohne passenden Schlüssel berührt ihn nicht, er bleibt nach dem Neustart gesperrt und
 * seine Einträge bleiben lesbar mit der Passphrase oder dem Wiederherstellungsschlüssel – es gibt nichts automatisch zurückzusetzen (`resetUnreadable` meldet 0, `affectedRows` keine Zeilen, nie stilles Löschen). `holdings` bleibt:
 * Vorgänge, die den Wiederherstellungsschlüssel erzeugen (er öffnet den Tresor) oder Sicherungen in fremde Hände bringen (sie enthalten die Hüllen des Hauptschlüssels), vermerken im Audit-Log auffällig, dass es Einträge gibt.
 */
export const secretConsumers: SecretConsumerDef[] = [
  { id: "it.vault", feature: "it.docs", resetUnreadable: resetUnreadableVaultEntries, affectedRows: affectedVaultRows, holdings: { label: "Tresor", count: vaultEntryCount } },
];
