import type { PrismaClient, Prisma } from "@/generated/prisma/client";

/**
 * Fortlaufende, **lückenlose** Zähler (Aufträge; später Rechnungen, Angebote …): Tabelle `Counter` mit Schlüssel und Jahr.
 *
 * Der Wert wird **in der Transaktion vergeben, die die Nummer verbraucht** (`tx` der Operation): Scheitert sie, rollt der Zähler mit zurück – es entsteht keine Lücke. SQLite hat einen
 * Schreiber, zwei gleichzeitige Transaktionen laufen nacheinander; der Zuwachs ist zusätzlich ein einziger atomarer `UPDATE … SET value = value + 1`, nie „lesen, rechnen, schreiben“.
 * Bewusst ohne `server-only`: Das Seed-Skript legt Aufträge an.
 */
type Client = Pick<PrismaClient | Prisma.TransactionClient, "counter">;

/** Nächster Wert des Zählers `key` im Jahr `year` (0 = ohne Jahreswechsel). Beginnt bei 1. */
export async function nextCounterValue(client: Client, key: string, year = 0): Promise<number> {
  const row = await client.counter.upsert({
    where: { key_year: { key, year } },
    create: { key, year, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return row.value;
}
