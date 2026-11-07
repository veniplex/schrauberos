import type { PrismaClient } from "@/generated/prisma/client";
import { ALL_SEEDS } from "@/modules/seed";

/**
 * Beispieldaten (Kunden, Fahrzeuge, Reifen, Termine, Netzwerk, Mitarbeiter, Fuhrpark, Rechnungen, Doku-Seiten) zum Ausprobieren. Werden bei der Ersteinrichtung auf Wunsch
 * angelegt und in der Entwicklung per Seed. Die Daten gehören den Funktionen (`demo` ihrer `seed.ts`); hier läuft nur die Reihenfolge. Jeder Beitrag legt nichts an, wenn seine
 * Tabelle schon Daten hat.
 */
export async function seedAllDemo(db: PrismaClient) {
  await seedPlatformDemo(db);
  for (const seed of ALL_SEEDS) await seed.demo?.(db);
}

/**
 * Beispielangaben der Plattform: Rechnungsangaben des Werkstattprofils (nur, wo noch nichts steht) und die Region der Feiertage (nur, wenn noch keine gewählt ist) –
 * damit Hinweise, Arbeitstage und die Einrichtungs-Checkliste im Demo etwas zeigen. Erfundene Nummern (Beispiel-IBAN der Prüfsummen-Beispiele).
 */
async function seedPlatformDemo(db: PrismaClient) {
  const workshop = await db.workshop.findUnique({ where: { id: "default" } });
  if (workshop && !workshop.taxNumber && !workshop.vatId && !workshop.iban) {
    await db.workshop.update({
      where: { id: "default" },
      data: {
        taxNumber: "21/815/08150",
        vatId: "DE123456789",
        bankName: "Beispielbank",
        iban: "DE89370400440532013000",
        bic: "COBADEFFXXX",
        paymentTermDays: 14,
        managingDirector: "Max Mustermann",
        registerCourt: "Amtsgericht Musterstadt",
        registerNumber: "HRB 12345",
        hourlyRateCents: 9500,
        workUnitMinutes: 5,
      },
    });
  }
  if (!(await db.holidaySettings.findUnique({ where: { id: "default" } }))) await db.holidaySettings.create({ data: { id: "default", region: "DE-NW" } });
}
