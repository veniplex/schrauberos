/**
 * Art. 18 DSGVO und Webhooks: Jede Funktion, die Ereignisse an Webhooks melden lässt (`webhookEvents` ihrer `feature.ts`), liefert in ihrer `webhooks.ts` auch die Prüfung, ob die **Sache** eines Ereignisses
 * als eingeschränkt gilt – mit **denselben Bedingungen** wie ihre API-Ressource (`customers/public.ts`: Kunde oder Fahrzeughalter eingeschränkt). Gesammelt in `src/modules/webhooks.ts`;
 * die Plattform kennt die Tabellen der Funktionen nicht. **Fail-closed:** Zu einer Ressource ohne Eintrag gehört keine Prüfung – ihre Ereignisse gehen nie hinaus (`webhooks.test.ts` prüft, dass jede Ressource des Katalogs einen Eintrag hat).
 */
export type WebhookRestrictionDef = {
  /** Name der API-Ressource wie in `webhookEvents` (z. B. `orders`) */
  resource: string;
  /** `true`, wenn die Sache eingeschränkt verarbeitet wird (dann geht nichts hinaus); fehlende Sache: `false` (es gibt nichts zu melden, nichts zu schützen) */
  restricted: (entityId: string) => Promise<boolean>;
};
