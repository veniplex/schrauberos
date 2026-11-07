import { MAIL_PASSWORD_SECRET } from "@/server/mail/settings";
import { resetUnreadableSettingSecrets, type SecretConsumerDef } from "@/server/secret-consumers";
import { setSetting } from "@/server/settings";

/**
 * Das SMTP-Passwort liegt verschlüsselt in den Einstellungen. Ist es nach einem Restore ohne passenden Schlüssel unlesbar, wird es entfernt und der Versand **ausgeschaltet** – es darf nichts mit
 * halber Konfiguration hinausgehen (neu eintragen unter Einstellungen → E-Mail und wieder einschalten).
 */
export const secretConsumers: SecretConsumerDef[] = [
  { id: "mail.password", feature: "admin.mail", resetUnreadable: () => resetUnreadableSettingSecrets([MAIL_PASSWORD_SECRET], () => setSetting("mail.enabled", "false")) },
];
