import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/**
 * Auskunft (Art. 15 DSGVO): die **Liste** der Dateien und Fotos an den Fahrzeugen und Aufträgen des Kunden – Name, Beschriftung, Art, Fahrzeug bzw. Auftrag, Zeitpunkt –, nicht ihr Inhalt (Bilder und
 * PDFs sind Dateien, die die Werkstatt auf Anfrage getrennt herausgibt). Die Auskunft liefert bewusst alles, unabhängig von den Leserechten und vom Archiv-Flag (auch entfernte Dateien existieren auf dem Datenträger).
 */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "files",
    feature: "workshop.files",
    order: 55,
    async collect({ id }) {
      const rows = await db.fileAttachment.findMany({
        where: { OR: [{ vehicle: { is: { customerId: id } } }, { order: { is: { customerId: id } } }] },
        orderBy: { createdAt: "asc" },
        select: { name: true, caption: true, category: true, mime: true, createdAt: true, archivedAt: true, vehicle: { select: { plate: true } }, order: { select: { number: true } } },
      });
      return [
        {
          id: "files",
          title: "privacy.sections.files",
          records: rows.map((f) => [
            field("name", "privacy.f.fileName", f.name),
            field("caption", "privacy.f.caption", f.caption),
            field("category", "privacy.f.category", f.category),
            field("plate", "privacy.f.plate", f.vehicle?.plate ?? null),
            field("orderNumber", "privacy.f.orderNumber", f.order?.number ?? null),
            dayField("createdAt", "privacy.f.createdAt", f.createdAt),
            dayField("archivedAt", "privacy.f.archivedAt", f.archivedAt),
          ]),
        },
      ];
    },
  },
];
