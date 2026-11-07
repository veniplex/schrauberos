import type { PrismaClient } from "@/generated/prisma/client";
import type { SeedDef } from "@/modules/types";

/**
 * Beispiel für die Oberfläche: ein **ausgeschalteter** Webhook ohne Signaturgeheimnis (das Geheimnis entsteht beim Einschalten bzw. mit „Neues Geheimnis“ und gehört nie in Beispieldaten),
 * auf eine Adresse, die es nicht gibt. Ein Beispiel-Token mit Klartext gibt es bewusst nicht: Tokens entstehen nur mit Passwortabfrage in der Oberfläche.
 */
async function demo(db: PrismaClient) {
  if ((await db.webhook.count()) > 0) return;
  console.log("Demo-Daten (Webhooks) werden angelegt …");
  await db.webhook.create({
    data: { name: "Beispiel: Buchhaltung (aus)", url: "https://buchhaltung.example.org/hooks/schrauberos", events: "billing.paid,billing.finalized", enabled: false, createdByName: "Administrator" },
  });
}

export const seeds: SeedDef[] = [{ id: "api-webhooks", feature: "admin.api", order: 300, demo }];
