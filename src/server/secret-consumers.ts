import "server-only";
import type { FeatureId } from "@/modules/catalog";
import { isForeignSecret } from "@/server/secrets";
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
   * **Scheitert diese Abfrage, setzt `secret-reset.ts` für diesen Verbraucher nichts zurück** (erst sichern, dann zurücksetzen) und meldet es; die übrigen Verbraucher laufen weiter. Nur Zeilen, die der Verbraucher hier meldet, darf sein `resetUnreadable` anfassen.
   */
  affectedRows?: () => Promise<Array<Record<string, unknown>>>;
  /**
   * Wie viele Einträge dieses Verbrauchers von `secret.key` abhängen (IT-Tresor: Einträge mit hinterlegten Zugangsdaten) und wie sie im Audit-Log heißen (`label`). Vorgänge, die `secret.key` oder Backups
   * in fremde Hände bringen können (Wiederherstellungsschlüssel erzeugen, Backup herunterladen oder wiederherstellen, Rechte vergeben), vermerken im Audit-Log **auffällig**, dass solche Einträge existieren
   * (`server/secret-holdings.ts`) – nie deren Inhalt –, und die Administration sieht den Hinweis im Systemstatus. Verbraucher mit einzelnen Geheimnissen (Update-Token …) brauchen das nicht.
   */
  holdings?: { label: string; count: () => Promise<number> };
};

/**
 * Hilfe für Geheimnisse in `AppSetting` (`setSecret`): Ist der gespeicherte Wert ein gut geformter `v1`-Wert, den der Schlüssel dieses Datenträgers nicht öffnet (`isForeignSecret`), wird die Einstellung gelöscht;
 * höhere Formatversionen (`v2:…`) und beschädigte Werte nie (dieselbe Regel wie in `secret-reset.ts`). `after` läuft, wenn etwas
 * gelöscht wurde (z. B. die abhängige Funktion ausschalten).
 */
export async function resetUnreadableSettingSecrets(keys: readonly string[], after?: () => Promise<void>): Promise<number> {
  let count = 0;
  for (const key of keys) {
    const row = await db.appSetting.findUnique({ where: { key } });
    if (row && isForeignSecret(row.value)) {
      await db.appSetting.deleteMany({ where: { key } });
      count++;
    }
  }
  if (count > 0) await after?.();
  return count;
}
