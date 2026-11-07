import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { normalizeInvoiceNumber } from "@/lib/invoice-number";
import { numberSlot, renderNumber, type NumberSlot } from "@/lib/invoice-numbering";
import { wallOf } from "@/lib/zone";
import { nextCounterValue } from "./counters";

/**
 * Vergabe der fortlaufenden Beleg-Nummer **in der Transaktion des Festschreibens** (F3, auch der Gegenbeleg `invoices.cancel`): Der Zähler (`Counter`) wächst in derselben Transaktion, die die Nummer
 * verbraucht – scheitert sie, rollt er zurück, es entsteht keine Lücke.
 *
 * **Manuell erfasste Fremdnummern** (Rechnungsarchiv) blockieren den Nummernkreis nicht, aber sie bleiben eindeutig (`Invoice.outgoingKey`): Ist die nächste Nummer schon vergeben, wird der Zähler
 * weitergestellt, bis eine freie Nummer gefunden ist (höchstens `MAX_SKIPS` Versuche, danach `NumberExhaustedError`). Eine übersprungene Nummer ist keine Lücke der Reihe: es gibt einen Beleg mit dieser Nummer.
 * Angebote und Auftragsbestätigungen haben eigene Reihen und ebenfalls eindeutige Nummern.
 */
type Client = Pick<PrismaClient | Prisma.TransactionClient, "counter" | "invoice">;

/** So viele aufeinanderfolgende vergebene Fremdnummern (z. B. aus dem CSV-Import) überspringt der Zähler, bevor er aufgibt. */
export const MAX_SKIPS = 5000;
export class NumberExhaustedError extends Error {
  constructor() {
    super("Nummernkreis: keine freie Nummer gefunden");
    this.name = "NumberExhaustedError";
  }
}

export async function allocateDocumentNumber(client: Client, docType: string, workshopFormat: string | null | undefined, now: Date): Promise<{ number: string; key: string }> {
  const wall = wallOf(now);
  const when = { year: wall.year, month: wall.month };
  const slot: NumberSlot = numberSlot(docType, workshopFormat, when);
  for (let attempt = 0; attempt <= MAX_SKIPS; attempt++) {
    const value = await nextCounterValue(client, slot.key, slot.year);
    const number = renderNumber(slot, when, value);
    const key = normalizeInvoiceNumber(number);
    if (!(await client.invoice.findFirst({ where: { outgoingKey: key }, select: { id: true } }))) return { number, key };
  }
  throw new NumberExhaustedError();
}
