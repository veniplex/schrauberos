import type { Tx } from "@/server/operations";

/** Vergleichsform einer Kundennummer: ohne Leerraum, Kleinbuchstaben. */
export const numberKey = (value: string): string => value.replace(/\s+/g, "").toLowerCase();

/**
 * Kundennummern → Kunden-IDs (für Importe, die Datensätze einem Kunden zuordnen). Die Kundennummer ist nicht eindeutig (das Schema erlaubt Dubletten): Eine Nummer mit mehreren
 * Treffern liefert mehrere IDs, der Aufrufer meldet sie als „nicht eindeutig“.
 */
export async function findCustomerIdsByNumber(client: Tx, numbers: readonly string[]): Promise<Map<string, string[]>> {
  const wanted = new Set(numbers.map(numberKey));
  const found = new Map<string, string[]>();
  if (wanted.size === 0) return found;
  const customers = await client.customer.findMany({ where: { customerNumber: { not: null } }, select: { id: true, customerNumber: true } });
  for (const c of customers) {
    const key = numberKey(c.customerNumber ?? "");
    if (wanted.has(key)) found.set(key, [...(found.get(key) ?? []), c.id]);
  }
  return found;
}
