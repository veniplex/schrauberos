import "server-only";
import { db } from "@/server/db";

/**
 * Art. 18 DSGVO und Webhooks: Ein Ereignis zu einer Sache eines Kunden mit **eingeschränkter Verarbeitung** geht nie hinaus – so wenig wie die API die Sache liest (`scope` der Ressourcen).
 * Die Prüfung steht hier, bei der Verwaltung der API, weil die Plattform (`server/webhooks`) die Tabellen der Funktionen nicht kennt; sie bildet die Bedingungen der API-Ressourcen nach
 * (Auftrag/Beleg: Kunde; Auftrag, Checkliste, Datei: auch der Kunde des Fahrzeugs). Unbekannte Ressource: nicht eingeschränkt (Ereignisse kommen nur aus dem Katalog der Funktionen).
 */
const restricted = { is: { processingRestrictedAt: { not: null } } };
const vehicleRestricted = { vehicle: { is: { customer: restricted } } };

export async function isRestrictedEntity(resource: string, id: string): Promise<boolean> {
  switch (resource) {
    case "orders":
      return (await db.order.count({ where: { id, OR: [{ customer: restricted }, vehicleRestricted] } })) > 0;
    case "billing-documents":
      return (await db.invoice.count({ where: { id, customer: restricted } })) > 0;
    case "checklists":
      return (await db.checklist.count({ where: { id, OR: [vehicleRestricted, { order: { is: { OR: [{ customer: restricted }, vehicleRestricted] } } }] } })) > 0;
    case "files":
      return (await db.fileAttachment.count({ where: { id, OR: [vehicleRestricted, { order: { is: { OR: [{ customer: restricted }, vehicleRestricted] } } }] } })) > 0;
    default:
      return false;
  }
}
