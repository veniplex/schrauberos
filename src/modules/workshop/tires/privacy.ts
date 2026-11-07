import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/** Auskunft: Reifensätze der Fahrzeuge, die der Kunde hält oder früher hielt, samt Notizen zu Satz und Reifen. */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "tires",
    feature: "workshop.tires",
    order: 40,
    async collect({ id }) {
      const sets = await db.tireSet.findMany({
        where: { vehicle: { OR: [{ customerId: id }, { ownerships: { some: { customerId: id } } }] } },
        orderBy: [{ storedAt: "asc" }],
        include: { vehicle: { select: { plate: true } }, tires: { select: { position: true, notes: true } } },
      });
      return [
        {
          id: "tireSets",
          title: "privacy.sections.tireSets",
          records: sets.map((s) => [
            field("plate", "privacy.f.plate", s.vehicle.plate),
            field("season", "privacy.f.season", s.season),
            field("brand", "privacy.f.brand", [s.brand, s.model].filter(Boolean).join(" ") || null),
            field("size", "privacy.f.size", s.width != null && s.aspect != null ? `${s.width}/${s.aspect} R${s.rim ?? ""}` : null),
            field("status", "privacy.f.status", s.status),
            field("storageLocation", "privacy.f.storageLocation", s.storageLocation),
            dayField("storedAt", "privacy.f.storedAt", s.storedAt),
            field("notes", "privacy.f.notes", s.notes),
            field("tireNotes", "privacy.f.tireNotes", s.tires.filter((t) => t.notes).map((t) => `${t.position}: ${t.notes}`).join("; ") || null),
          ]),
        },
      ];
    },
  },
];
