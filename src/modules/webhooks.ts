import type { WebhookRestrictionDef } from "@/server/webhooks/restriction-types";

import { webhookRestrictions as billing } from "./office/billing/webhooks";
import { webhookRestrictions as checklists } from "./workshop/checklists/webhooks";
import { webhookRestrictions as files } from "./workshop/files/webhooks";
import { webhookRestrictions as orders } from "./workshop/orders/webhooks";

/**
 * Composition Root der Art.-18-Prüfungen für Webhook-Ereignisse (wird nur von `src/modules/admin/api/restriction.ts` importiert): Jede Funktion mit `webhookEvents` meldet in ihrer `webhooks.ts`
 * (`webhookRestrictions`), wann die Sache eines Ereignisses als eingeschränkt gilt. Neue Funktion mit Webhook-Ereignissen: `webhooks.ts` anlegen, Zeile ergänzen – ohne Eintrag geht nichts hinaus
 * (fail-closed, `src/server/webhooks/webhooks.test.ts`).
 */
export const featureWebhookRestrictions: readonly WebhookRestrictionDef[] = [...orders, ...billing, ...checklists, ...files];
