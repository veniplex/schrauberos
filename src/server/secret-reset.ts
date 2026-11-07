import "server-only";
import { logError } from "@/lib/log-safe";
import { featureSecretConsumers } from "@/modules/secrets";
import { audit } from "@/server/audit";
import { resetUnreadableSecondFactors } from "@/server/auth/second-factor";
import { db } from "@/server/db";
import { dropStaleRecoveryKey } from "@/server/recovery-key";
import type { SecretConsumerDef } from "@/server/secret-consumers";
import { setSetting } from "@/server/settings";

/**
 * Alle Verbraucher von `secret.key` (Register: `secret-consumers.ts`): Plattform und Funktionen. Der zweite Faktor (TOTP) gehört zur Plattform.
 */
export const platformSecretConsumers: readonly SecretConsumerDef[] = [{ id: "auth.totp", resetUnreadable: resetUnreadableSecondFactors }];

export const allSecretConsumers = (): readonly SecretConsumerDef[] => [...platformSecretConsumers, ...featureSecretConsumers];

export type SecretResetItem = { id: string; count: number };
export type SecretResetNotice = { at: string; items: SecretResetItem[]; /** Die Hülle des Wiederherstellungsschlüssels gehörte nicht zu diesem Datenträger und wurde entfernt */ keyDropped: boolean };

const NOTICE_KEY = "secrets.resetNotice";

/**
 * Beim Start: Jeder Verbraucher setzt zurück, was er nicht mehr lesen kann (Backup ohne passenden `secret.key` und ohne Wiederherstellungsschlüssel). Gibt es etwas, wird es
 * **ins Audit-Log** geschrieben (nur Verbraucher und Anzahl, nie Inhalt) und als Hinweis für **Administratoren** vermerkt (bis sie ihn bestätigen). Eine veraltete Hülle des
 * Wiederherstellungsschlüssels (gehört nicht zum Schlüssel dieses Datenträgers) wird dabei entfernt – ein neuer Schlüssel ist nötig. Ein Fehler eines Verbrauchers hindert die anderen nicht.
 */
export async function resetUnreadableSecrets(consumers: readonly SecretConsumerDef[] = allSecretConsumers()): Promise<SecretResetItem[]> {
  const items: SecretResetItem[] = [];
  for (const consumer of consumers) {
    try {
      const count = await consumer.resetUnreadable();
      if (count > 0) items.push({ id: consumer.id, count });
    } catch (error) {
      logError(`secrets:reset:${consumer.id}`, error);
    }
  }
  const keyDropped = await dropStaleRecoveryKey(db).catch((error) => (logError("secrets:dropKey", error), false));
  if (items.length === 0 && !keyDropped) return items;
  await audit("secrets.reset", {
    actor: { id: null, name: "System" },
    target: [...items.map((i) => `${i.id}: ${i.count}`), ...(keyDropped ? ["Wiederherstellungsschlüssel veraltet"] : [])].join(" · "),
  });
  const previous = await readResetNotice();
  const merged = new Map<string, number>((previous?.items ?? []).map((i) => [i.id, i.count]));
  for (const item of items) merged.set(item.id, (merged.get(item.id) ?? 0) + item.count);
  const notice: SecretResetNotice = { at: new Date().toISOString(), items: [...merged].map(([id, count]) => ({ id, count })), keyDropped: keyDropped || !!previous?.keyDropped };
  await setSetting(NOTICE_KEY, JSON.stringify(notice));
  return items;
}

/** Der offene Hinweis „nach der Wiederherstellung wurden Geheimnisse zurückgesetzt“ (null: keiner). */
export async function readResetNotice(client: Pick<typeof db, "appSetting"> = db): Promise<SecretResetNotice | null> {
  const raw = (await client.appSetting.findUnique({ where: { key: NOTICE_KEY } }))?.value ?? null;
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SecretResetNotice>;
    if (typeof value.at !== "string" || !Array.isArray(value.items)) return null;
    return {
      at: value.at,
      items: value.items.filter((i): i is SecretResetItem => !!i && typeof i.id === "string" && typeof i.count === "number"),
      keyDropped: value.keyDropped === true,
    };
  } catch {
    return null;
  }
}

/** Hinweis als gesehen markieren (Administrator). */
export async function acknowledgeResetNotice(client: Pick<typeof db, "appSetting">): Promise<void> {
  await client.appSetting.deleteMany({ where: { key: NOTICE_KEY } });
}
