import "server-only";
import { featureOfPermission } from "@/modules/catalog";
import { featureSecretConsumers } from "@/modules/secrets";
import { logError } from "@/lib/log-safe";

/**
 * **Wofür ein Schlüsselvorgang gefährlich ist:** Der Tresor (und jedes künftige Geheimnis-Lager) hängt an `secret.key`, und `secret.key` lässt sich aus dem **Wiederherstellungsschlüssel** und jeder Sicherung
 * rekonstruieren. Wer den Wiederherstellungsschlüssel erzeugt oder besitzt und Sicherungen laden darf, kann den Tresor außerhalb der Anwendung lesen – ohne Tresor-Recht, ohne Passwortabfrage und ohne den
 * Eintrag `vault.reveal`. Das ist die Folge von „ein Schlüssel für alles“ (README „IT-Tresor – Grenzen“), keine Lücke im Code; die Gegenmaßnahme ist **Sichtbarkeit**: Gibt es Einträge, vermerkt jeder dieser
 * Vorgänge im Audit-Log, dass der Tresor betroffen ist (Anzahl, nie Inhalt), und Administratoren sehen im Systemstatus den Hinweis darauf.
 *
 * Betroffene Vorgänge: Wiederherstellungsschlüssel erzeugen/erneuern (`secrets.keyCreated`; angezeigt wird er nur dabei), Sicherung herunterladen (`backup.download`), Sicherung wiederherstellen
 * (`backup.restore`), Schlüssel rekonstruieren (`secrets.keyReconstructed`) und die Vergabe ausdrücklich zu vergebender Rechte (`role.explicitGrant`, `user.explicitGrant`).
 */
export type Holding = { id: string; feature: string | null; label: string; count: number };

/** Verbraucher mit abhängigen Einträgen (Anzahl > 0). Ein Fehler beim Zählen lässt den Vorgang nie scheitern (nur der Code wird protokolliert). */
export async function secretHoldings(): Promise<Holding[]> {
  const found: Holding[] = [];
  for (const consumer of featureSecretConsumers) {
    if (!consumer.holdings) continue;
    try {
      const count = await consumer.holdings.count();
      if (count > 0) found.push({ id: consumer.id, feature: consumer.feature ?? null, label: consumer.holdings.label, count });
    } catch (error) {
      logError(`secrets:holdings:${consumer.id}`, error);
    }
  }
  return found;
}

const text = (holdings: readonly Holding[]) => holdings.map((h) => `${h.label} betroffen (${h.count} ${h.count === 1 ? "Eintrag" : "Einträge"})`).join(", ");

/** Zusatz für das Audit-Log: `Sicherung X · Tresor betroffen (3 Einträge)`. Ohne abhängige Einträge bleibt der Text, wie er war. */
export const withHoldings = (base: string, holdings: readonly Holding[]): string => (holdings.length === 0 ? base : `${base} · ${text(holdings)}`);

/** Nur die Verbraucher der Funktion, zu der das Recht gehört (die Vergabe des Tresor-Rechts betrifft den Tresor, nicht jedes andere Geheimnis-Lager). */
export const holdingsOfPermission = (holdings: readonly Holding[], permission: string): Holding[] => {
  const feature = featureOfPermission(permission);
  return feature ? holdings.filter((h) => h.feature === feature) : [];
};
