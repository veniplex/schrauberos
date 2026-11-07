import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/** Auskunft: Aufträge des Kunden mit Kundenwunsch, Befunden und Freigaben (Beträge, freigebende Person, getippter Name, Hinweis auf die gespeicherte Unterschrift-Bilddatei). Die Auskunft liefert bewusst alles, unabhängig von den Leserechten. */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "orders",
    feature: "workshop.orders",
    order: 50,
    async collect({ id }) {
      const orders = await db.order.findMany({
        where: { customerId: id },
        orderBy: { acceptedAt: "asc" },
        select: {
          number: true,
          status: true,
          acceptedAt: true,
          mileageKm: true,
          request: true,
          vehicle: { select: { plate: true } },
          findings: { orderBy: { createdAt: "asc" }, select: { text: true } },
          approvals: { orderBy: { createdAt: "asc" }, select: { amountCents: true, reason: true, method: true, approverName: true, signedName: true, signaturePath: true, createdAt: true } },
        },
      });
      return [
        {
          id: "orders",
          title: "privacy.sections.orders",
          records: orders.map((o) => [
            field("number", "privacy.f.number", o.number),
            field("plate", "privacy.f.plate", o.vehicle.plate),
            field("status", "privacy.f.status", o.status),
            dayField("acceptedAt", "privacy.f.acceptedAt", o.acceptedAt),
            field("mileageKm", "privacy.f.mileageKm", o.mileageKm == null ? null : String(o.mileageKm)),
            field("request", "privacy.f.request", o.request),
            field("findings", "privacy.f.findings", o.findings.map((f) => f.text).join("; ") || null),
            field(
              "approvals",
              "privacy.f.approvals",
              o.approvals
                .map((a) => `${(a.amountCents / 100).toFixed(2)} EUR, ${a.approverName}, ${a.method}${a.signedName ? ` (getippter Name: ${a.signedName})` : ""}${a.signaturePath ? " (Unterschrift als Bilddatei gespeichert)" : ""}: ${a.reason}`)
                .join("; ") || null,
            ),
          ]),
        },
      ];
    },
  },
];
