import "server-only";
import { field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/** Auskunft: alle Termine des Kunden mit Titel und Notizen (Freitexte). */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "appointments",
    feature: "workshop.appointments",
    order: 30,
    async collect({ id }) {
      const rows = await db.appointment.findMany({ where: { customerId: id }, orderBy: { startsAt: "asc" }, include: { type: { select: { name: true } }, vehicle: { select: { plate: true } } } });
      return [
        {
          id: "appointments",
          title: "privacy.sections.appointments",
          records: rows.map((a) => [
            field("startsAt", "privacy.f.startsAt", a.startsAt),
            field("endsAt", "privacy.f.endsAt", a.endsAt),
            field("title", "privacy.f.title", a.title),
            field("type", "privacy.f.type", a.type?.name),
            field("status", "privacy.f.status", a.status),
            field("plate", "privacy.f.plate", a.vehicle?.plate),
            field("notes", "privacy.f.notes", a.notes),
          ]),
        },
      ];
    },
  },
];
