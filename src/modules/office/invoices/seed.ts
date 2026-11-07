import type { PrismaClient } from "@/generated/prisma/client";
import { outgoingKeyOf } from "@/lib/invoice-number";
import { searchKey } from "@/lib/search-key";
import { atDay, noonOf } from "@/lib/seed-days";
import type { SeedDef } from "@/modules/types";

/** Beispielrechnungen (Eingang und Ausgang); Ausgangsrechnungen gehören den ersten drei Demo-Kunden, soweit es sie gibt. */
async function demo(db: PrismaClient) {
  if ((await db.invoice.count()) > 0) return;
  console.log("Demo-Daten (Rechnungen) werden angelegt …");

  const customers = await db.customer.findMany({ take: 3, orderBy: { customerNumber: "asc" } });
  const inv = (direction: "incoming" | "outgoing", number: string, partyName: string, issueAgo: number, dueIn: number | null, grossCents: number, status = "open", extra: Record<string, unknown> = {}) =>
    db.invoice.create({
      data: {
        direction, number, outgoingKey: outgoingKeyOf(direction, number), partyName, partyKey: searchKey(partyName), issueDate: noonOf(atDay(-issueAgo)), dueDate: dueIn == null ? null : noonOf(atDay(dueIn)),
        grossCents, netCents: Math.round(grossCents / 1.19), vatCents: grossCents - Math.round(grossCents / 1.19),
        status, paidAt: status === "paid" ? noonOf(atDay(-Math.max(issueAgo - 10, 1))) : null, ...extra,
      },
    });
  await inv("incoming", "RE-2026-4411", "Reifengroßhandel Nord GmbH", 40, -10, 482350, "open", { category: "Material", reference: "Ordner Eingang 2026/11" });
  await inv("incoming", "AM-77310", "Autoteile Müller", 22, 8, 123780, "open", { category: "Material" });
  await inv("incoming", "SW-11-2026", "Stadtwerke", 15, 15, 41280, "open", { category: "Nebenkosten" });
  await inv("incoming", "TK-9981234", "Telekom Deutschland", 30, -2, 18990, "open", { category: "Telefon/Internet" });
  await inv("incoming", "BB-2026-088", "Büro-Bedarf Schmitt", 60, -30, 9450, "paid", { category: "Büro" });
  await inv("incoming", "SV-2026-Q4", "Sicher Versicherung AG", 70, -40, 214000, "paid", { category: "Versicherung", reference: "Policen-Ordner" });
  await inv("outgoing", "2026-0187", customers[0] ? `${customers[0].firstName ?? ""} ${customers[0].lastName}`.trim() : "Kunde", 35, -5, 31250, "open", { customerId: customers[0]?.id, category: "Inspektion" });
  await inv("outgoing", "2026-0188", customers[1]?.company ?? customers[1]?.lastName ?? "Kunde", 20, 10, 128900, "open", { customerId: customers[1]?.id, category: "Reparatur" });
  await inv("outgoing", "2026-0189", customers[2] ? `${customers[2].firstName ?? ""} ${customers[2].lastName}`.trim() : "Kunde", 12, 2, 8900, "open", { customerId: customers[2]?.id, category: "Reifenwechsel" });
  await inv("outgoing", "2026-0176", customers[0] ? `${customers[0].firstName ?? ""} ${customers[0].lastName}`.trim() : "Kunde", 80, -50, 45600, "paid", { customerId: customers[0]?.id, category: "Reifenlagerung" });
}

export const seeds: SeedDef[] = [{ id: "invoices", feature: "office.invoices", order: 120, demo }];
