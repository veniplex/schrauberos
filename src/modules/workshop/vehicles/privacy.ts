import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/** Auskunft: die Fahrzeuge, die der Kunde hält, und die Halterhistorie (auch frühere Fahrzeuge). */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "vehicles",
    feature: "workshop.vehicles",
    order: 20,
    async collect({ id }) {
      const [vehicles, ownerships] = await Promise.all([
        db.vehicle.findMany({ where: { customerId: id }, orderBy: { plateNorm: "asc" } }),
        db.vehicleOwnership.findMany({ where: { customerId: id }, orderBy: { fromDate: "asc" }, include: { vehicle: { select: { plate: true } } } }),
      ]);
      return [
        {
          id: "vehicles",
          title: "privacy.sections.vehicles",
          records: vehicles.map((v) => [
            field("plate", "privacy.f.plate", v.plate),
            field("make", "privacy.f.make", v.make),
            field("model", "privacy.f.model", v.model),
            field("year", "privacy.f.year", v.year),
            field("vin", "privacy.f.vin", v.vin),
            field("notes", "privacy.f.notes", v.notes),
            dayField("archivedAt", "privacy.f.archivedAt", v.archivedAt),
          ]),
        },
        {
          id: "ownerships",
          title: "privacy.sections.ownerships",
          records: ownerships.map((o) => [
            field("plate", "privacy.f.plate", o.vehicle.plate),
            dayField("fromDate", "privacy.f.from", o.fromDate),
            dayField("toDate", "privacy.f.to", o.toDate),
            field("note", "privacy.f.notes", o.note),
          ]),
        },
      ];
    },
  },
];
