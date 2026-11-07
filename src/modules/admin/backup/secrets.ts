import { OFFSITE_CREDENTIALS_SECRET } from "@/server/backup/offsite/settings";
import { OFFSITE_MASTER_SECRET } from "@/server/recovery-key";
import { resetUnreadableSettingSecrets, type SecretConsumerDef } from "@/server/secret-consumers";
import { getSetting, setSetting } from "@/server/settings";

/**
 * Geheimnisse des Off-Site-Backups: die Zugangsdaten zum Ziel und der aus dem Wiederherstellungsschlüssel abgeleitete Hauptschlüssel der Verschlüsselung (beide mit `secret.key`
 * verschlüsselt). Sind sie nach einem Restore ohne passenden Schlüssel unlesbar, werden sie entfernt und Off-Site ausgeschaltet – es darf nichts mehr hochgeladen werden, was sich
 * nicht entschlüsseln lässt. Nach neuem Wiederherstellungsschlüssel und neu eingegebenen Zugangsdaten lässt sich Off-Site wieder einschalten.
 * Gemeldet (Hinweis, Audit) wird nur, wenn Off-Site eingerichtet war: der Hauptschlüssel allein (er entsteht mit dem Wiederherstellungsschlüssel) ist keine Meldung wert.
 */
export const secretConsumers: SecretConsumerDef[] = [
  {
    id: "backup.offsite",
    feature: "admin.backup",
    resetUnreadable: async () => {
      const wasEnabled = (await getSetting("offsite.enabled")) === "true";
      const master = await resetUnreadableSettingSecrets([OFFSITE_MASTER_SECRET]);
      const credentials = await resetUnreadableSettingSecrets([OFFSITE_CREDENTIALS_SECRET]);
      if (master + credentials > 0) await setSetting("offsite.enabled", "false");
      return credentials + (master > 0 && wasEnabled ? 1 : 0);
    },
  },
];
