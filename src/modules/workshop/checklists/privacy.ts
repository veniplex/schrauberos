import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/**
 * Auskunft (Art. 15 DSGVO): die Checklisten an den Fahrzeugen und Aufträgen des Kunden – Vorlage, Zustand, Datum, Kundenname und getippter Name der Unterschrift, Hinweis auf die gespeicherte Unterschrift als
 * Bilddatei, Anmerkung und die Freitexte der Punkte. Die Auskunft liefert bewusst alles, unabhängig von den Leserechten.
 */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "checklists",
    feature: "workshop.checklists",
    order: 56,
    async collect({ id }) {
      const rows = await db.checklist.findMany({
        where: { OR: [{ vehicle: { is: { customerId: id } } }, { order: { is: { customerId: id } } }] },
        orderBy: { createdAt: "asc" },
        select: {
          templateName: true,
          status: true,
          createdAt: true,
          completedAt: true,
          customerName: true,
          signedName: true,
          signaturePath: true,
          note: true,
          vehicle: { select: { plate: true } },
          order: { select: { number: true } },
          items: { where: { type: "text", textValue: { not: null } }, orderBy: { position: "asc" }, select: { label: true, textValue: true } },
        },
      });
      return [
        {
          id: "checklists",
          title: "privacy.sections.checklists",
          records: rows.map((c) => [
            field("template", "privacy.f.checklist", c.templateName),
            field("status", "privacy.f.status", c.status),
            field("plate", "privacy.f.plate", c.vehicle.plate),
            field("orderNumber", "privacy.f.orderNumber", c.order?.number ?? null),
            dayField("createdAt", "privacy.f.createdAt", c.createdAt),
            dayField("completedAt", "privacy.f.completedAt", c.completedAt),
            field("customerName", "privacy.f.signatory", c.customerName),
            field("signedName", "privacy.f.typedName", c.signedName),
            field("signature", "privacy.f.signatureImage", c.signaturePath ? "gespeichert (Bilddatei)" : null),
            field("note", "privacy.f.notes", c.note),
            field("texts", "privacy.f.checklistTexts", c.items.map((i) => `${i.label}: ${i.textValue}`).join("; ") || null),
          ]),
        },
      ];
    },
  },
];
