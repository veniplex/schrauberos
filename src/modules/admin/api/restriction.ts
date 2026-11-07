import "server-only";
import { featureWebhookRestrictions } from "@/modules/webhooks";

/**
 * Art. 18 DSGVO und Webhooks: Ein Ereignis zu einer Sache eines Kunden mit **eingeschränkter Verarbeitung** geht nie hinaus – so wenig wie die API die Sache liest.
 * Die Prüfung liefert die **Funktion, der die Ressource gehört** (`webhooks.ts` → `webhookRestrictions`, gesammelt in `src/modules/webhooks.ts`) mit derselben Bedingung wie ihre API-Ressource
 * (`customers/public.ts`: Kunde oder Fahrzeughalter eingeschränkt); hier steht keine Tabelle. **Fail-closed:** Zu einer Ressource ohne Eintrag gibt es keine Prüfung – dann gilt die Sache als
 * eingeschränkt, das Ereignis geht nicht hinaus (der Test in `webhooks.test.ts` deckt jede Ressource des Katalogs ab).
 */
export async function isRestrictedEntity(resource: string, id: string): Promise<boolean> {
  const def = featureWebhookRestrictions.find((d) => d.resource === resource);
  if (!def) return true;
  return def.restricted(id);
}
