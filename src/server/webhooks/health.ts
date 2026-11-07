import "server-only";
import { db } from "@/server/db";
import { TEST_TYPE } from "./deliver";

/**
 * Was am Webhook-Betrieb auffällt (Systemstatus, Seiten der Verwaltung): **aufgegebene** Zustellungen (Dead-Letter; ohne Test-Ereignisse und ohne die absichtliche Unterdrückung nach Art. 18, die kein Ausfall ist)
 * und Ziele, die die Anwendung **selbst ausgeschaltet** hat (Ziel meldet 410, Geheimnis unlesbar, Wiederherstellung).
 */
export async function webhookHealth(): Promise<{ deadLetters: number; disabledByApp: number }> {
  const [deadLetters, disabledByApp] = await Promise.all([
    db.webhookDelivery.count({ where: { status: "failed", type: { not: TEST_TYPE } } }),
    db.webhook.count({ where: { enabled: false, disabledReason: { not: null } } }),
  ]);
  return { deadLetters, disabledByApp };
}
