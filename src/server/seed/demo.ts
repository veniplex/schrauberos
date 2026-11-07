import type { PrismaClient } from "@/generated/prisma/client";
import { ALL_SEEDS } from "@/modules/seed";

/**
 * Beispieldaten (Kunden, Fahrzeuge, Reifen, Termine, Netzwerk, Mitarbeiter, Fuhrpark, Rechnungen, Doku-Seiten) zum Ausprobieren. Werden bei der Ersteinrichtung auf Wunsch
 * angelegt und in der Entwicklung per Seed. Die Daten gehören den Funktionen (`demo` ihrer `seed.ts`); hier läuft nur die Reihenfolge. Jeder Beitrag legt nichts an, wenn seine
 * Tabelle schon Daten hat.
 */
export async function seedAllDemo(db: PrismaClient) {
  for (const seed of ALL_SEEDS) await seed.demo?.(db);
}
