import type { SecretConsumerDef } from "@/server/secret-consumers";

import { secretConsumers as backup } from "./admin/backup/secrets";
import { secretConsumers as updates } from "./admin/updates/secrets";

/**
 * Composition Root der Geheimnis-Verbraucher (wird nur von `src/server/secret-reset.ts` importiert): Jede Funktion, die Geheimnisse mit `secret.key` verschlüsselt speichert,
 * meldet in ihrer `secrets.ts` (`secretConsumers`), wie sie Unlesbares zurücksetzt. Neue Funktion mit Geheimnissen: `secrets.ts` anlegen, Zeile ergänzen.
 */
export const featureSecretConsumers: readonly SecretConsumerDef[] = [...backup, ...updates];
