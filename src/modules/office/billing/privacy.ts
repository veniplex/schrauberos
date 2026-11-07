import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/**
 * Auskunft (Art. 15 DSGVO) zu den Belegen der Rechnungserstellung: Angebote, Auftragsbestätigungen, Entwürfe und Rechnungen des Kunden mit Empfängerangaben, Beträgen, Daten und den Positionen – und das
 * **Sendeprotokoll**: an welche Adresse welcher Beleg wann per E-Mail ging (Mail-Zeilen mit Zweck `billing`; das Protokoll hält Empfänger und Betreff bis zu einem Jahr). Von Hand erfasste Rechnungen
 * nennt der Beitrag des Rechnungsarchivs. Aufbewahrungsfristen der Buchungsbelege meldet das Archiv (es zählt auch Belege der Rechnungserstellung); **Angebote und Auftragsbestätigungen** zählen hier als
 * Belege der kürzeren Frist (`invoice`, Platzhalter, bis zur Bestätigung durch Steuerberater/Administrator), Entwürfe haben keine.
 */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "billing",
    feature: "office.billing",
    order: 51,
    async collect({ id }) {
      const rows = await db.invoice.findMany({
        where: { customerId: id, source: "billing" },
        orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true, docType: true, number: true, partyName: true, partyStreet: true, partyZip: true, partyCity: true, buyerEmail: true, issueDate: true, finalizedAt: true, validUntil: true,
          netCents: true, vatCents: true, grossCents: true, status: true, offerStatus: true, sentAt: true, introText: true, footerText: true,
          items: { orderBy: { position: "asc" }, select: { description: true, quantityMilli: true, unitCents: true } },
        },
      });
      const ids = rows.map((r) => r.id);
      const mails = ids.length > 0 ? await db.mailMessage.findMany({ where: { purpose: "billing", entityId: { in: ids } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, toAddresses: true, subject: true, status: true, sentAt: true, entityId: true } }) : [];
      const euros = (cents: number | null) => (cents == null ? null : (cents / 100).toFixed(2));
      return [
        {
          id: "billing",
          title: "billing.privacy.section",
          records: rows.map((r) => [
            field("docType", "privacy.f.docType", r.docType),
            field("number", "privacy.f.number", r.number || null),
            field("partyName", "privacy.f.partyName", r.partyName),
            field("address", "privacy.f.address", [r.partyStreet, [r.partyZip, r.partyCity].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null),
            field("email", "privacy.f.email", r.buyerEmail),
            dayField("issueDate", "privacy.f.issueDate", r.finalizedAt ? r.issueDate : null),
            dayField("validUntil", "privacy.f.validUntil", r.validUntil),
            field("net", "privacy.f.net", euros(r.netCents)),
            field("vat", "privacy.f.vat", euros(r.vatCents)),
            field("gross", "privacy.f.gross", euros(r.grossCents)),
            field("status", "privacy.f.status", r.finalizedAt ? (r.offerStatus ?? r.status) : "draft"),
            field("items", "privacy.f.items", r.items.map((i) => `${i.description} (${i.quantityMilli / 1000} × ${(i.unitCents / 100).toFixed(2)} EUR)`).join("; ") || null),
            field("notes", "privacy.f.notes", [r.introText, r.footerText].filter(Boolean).join(" / ") || null),
            dayField("sentAt", "privacy.f.sentAt", r.sentAt),
          ]),
        },
        {
          id: "billingMails",
          title: "billing.privacy.sent",
          records: mails.map((m) => [dayField("createdAt", "privacy.f.createdAt", m.createdAt), field("to", "privacy.f.recipient", m.toAddresses), field("subject", "privacy.f.subject", m.subject), field("status", "privacy.f.status", m.status), dayField("sentAt", "privacy.f.sentAt", m.sentAt)]),
        },
      ];
    },
    async retention({ id }) {
      // Angebote und Auftragsbestätigungen (ausgestellt): Belege der kürzeren Frist; Buchungsbelege meldet das Rechnungsarchiv
      const rows = await db.invoice.findMany({ where: { customerId: id, source: "billing", docType: { in: ["offer", "confirmation"] }, finalizedAt: { not: null } }, select: { issueDate: true } });
      return rows.map((r) => ({ date: r.issueDate, kind: "invoice" as const }));
    },
  },
];
