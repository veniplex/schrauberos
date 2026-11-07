import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/**
 * Auskunft: die mit dem Kunden verknüpften Rechnungen (Partei, Beträge, Daten, Notizen) – und die Belege, deren **Aufbewahrungsfrist** die Anonymisierung sperrt
 * (festgeschriebene zählen zu den Büchern, die übrigen zu den Buchungsbelegen; siehe `src/lib/privacy.ts`).
 */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "invoices",
    feature: "office.invoices",
    order: 50,
    async collect({ id }) {
      const rows = await db.invoice.findMany({ where: { customerId: id }, orderBy: [{ issueDate: "asc" }, { number: "asc" }], include: { cancels: { select: { number: true } } } });
      const euros = (cents: number | null) => (cents == null ? null : (cents / 100).toFixed(2));
      return [
        {
          id: "invoices",
          title: "privacy.sections.invoices",
          records: rows.map((i) => [
            field("number", "privacy.f.number", i.number),
            field("partyName", "privacy.f.partyName", i.partyName),
            dayField("issueDate", "privacy.f.issueDate", i.issueDate),
            dayField("dueDate", "privacy.f.dueDate", i.dueDate),
            field("net", "privacy.f.net", euros(i.netCents)),
            field("vat", "privacy.f.vat", euros(i.vatCents)),
            field("gross", "privacy.f.gross", euros(i.grossCents)),
            field("status", "privacy.f.status", i.status),
            dayField("paidAt", "privacy.f.paidAt", i.paidAt),
            field("category", "privacy.f.category", i.category),
            field("reference", "privacy.f.reference", i.reference),
            field("notes", "privacy.f.notes", i.notes),
            dayField("finalizedAt", "privacy.f.finalizedAt", i.finalizedAt),
            field("cancels", "privacy.f.cancels", i.cancels?.number),
          ]),
        },
      ];
    },
    async retention({ id }) {
      const rows = await db.invoice.findMany({ where: { customerId: id }, select: { issueDate: true, finalizedAt: true } });
      return rows.map((r) => ({ date: r.issueDate, kind: r.finalizedAt ? ("finalizedInvoice" as const) : ("invoice" as const) }));
    },
  },
];
