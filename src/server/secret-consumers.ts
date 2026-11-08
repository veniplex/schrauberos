import "server-only";
import type { FeatureId } from "@/modules/catalog";
import { decryptSecret } from "@/server/secrets";
import { db } from "@/server/db";

/**
 * Register der Geheimnis-Verbraucher (P1b-4a): Jede Stelle, die ein Geheimnis mit `secret.key` verschlüsselt ablegt (`setSecret`, TOTP, später Mail-Passwort, Webhook-Secrets,
 * Tresor-Schlüssel …), meldet hier, wie sich ihr Bestand **zurücksetzen** lässt, wenn er nicht mehr lesbar ist – das ist der Fall, wenn ein Backup ohne den passenden
 * `secret.key` und ohne Wiederherstellungsschlüssel wiederhergestellt wurde. Beim Start läuft `resetUnreadableSecrets` (siehe `secret-reset.ts`): Jeder Verbraucher
 * räumt genau das weg, was er nicht mehr entschlüsseln kann; das Ergebnis erscheint im Audit-Log und – nur für Administratoren – als Hinweis.
 *
 * Die Plattform kennt keine Funktion: Funktionen melden ihre Verbraucher in einer `secrets.ts` (`secretConsumers`), eingesammelt in `src/modules/secrets.ts`.
 * Neue verschlüsselte Geheimnisse **müssen** dort (oder hier, wenn sie zur Plattform gehören) angemeldet werden; `src/architecture.test.ts` prüft, dass jede `secrets.ts` eingetragen ist.
 */
export type SecretConsumerDef = {
  /** Eindeutig, `<bereich>.<name>`; Beschriftung unter `backup.reset.consumers.<id>` */
  id: string;
  /** Funktion, der der Verbraucher gehört (nur zur Zuordnung; zurückgesetzt wird auch bei ausgeschalteter Funktion) */
  feature?: FeatureId;
  /** Setzt alle nicht mehr lesbaren Geheimnisse dieses Verbrauchers zurück und liefert ihre Anzahl. Idempotent; darf nur Unlesbares anfassen. */
  resetUnreadable: () => Promise<number>;
  /**
   * Die Zeilen, die `resetUnreadable` anfassen würde (nur bereits verschlüsselte Werte, nie Klartext): Sie werden **vor** dem Zurücksetzen als Teil der Sicherung `secret-reset/<Zeit>.json` abgelegt.
   * Verbraucher, deren Geheimnisse nicht in `AppSetting`/`TwoFactor` liegen (z. B. der IT-Tresor), liefern sie hier – ohne diese Angabe gäbe es für ihre Zeilen keine Sicherung.
   */
  affectedRows?: () => Promise<Array<Record<string, unknown>>>;
};

/**
 * Hilfe für Geheimnisse in `AppSetting` (`setSecret`): Ist der gespeicherte Wert vorhanden, aber nicht entschlüsselbar, wird die Einstellung gelöscht. `after` läuft, wenn etwas
 * gelöscht wurde (z. B. die abhängige Funktion ausschalten).
 */
export async function resetUnreadableSettingSecrets(keys: readonly string[], after?: () => Promise<void>): Promise<number> {
  let count = 0;
  for (const key of keys) {
    const row = await db.appSetting.findUnique({ where: { key } });
    if (row && decryptSecret(row.value) === null) {
      await db.appSetting.deleteMany({ where: { key } });
      count++;
    }
  }
  if (count > 0) await after?.();
  return count;
}
