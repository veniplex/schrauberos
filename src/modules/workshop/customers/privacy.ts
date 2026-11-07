import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";

/** Auskunft: der Stammsatz des Kunden mit allen Feldern, auch Notizen und den Vermerken zur Einschränkung. */
export const privacyProviders: PrivacyProviderDef[] = [
  {
    id: "customers",
    feature: "workshop.customers",
    order: 10,
    async collect({ id }) {
      const c = await db.customer.findUnique({ where: { id } });
      if (!c) return [];
      return [
        {
          id: "customer",
          title: "privacy.sections.customer",
          records: [
            [
              field("customerNumber", "privacy.f.customerNumber", c.customerNumber),
              field("firstName", "privacy.f.firstName", c.firstName),
              field("lastName", "privacy.f.lastName", c.lastName),
              field("company", "privacy.f.company", c.company),
              field("email", "privacy.f.email", c.email),
              field("phone", "privacy.f.phone", c.phone),
              field("street", "privacy.f.street", c.street),
              field("zip", "privacy.f.zip", c.zip),
              field("city", "privacy.f.city", c.city),
              field("notes", "privacy.f.notes", c.notes),
              dayField("createdAt", "privacy.f.createdAt", c.createdAt),
              dayField("updatedAt", "privacy.f.updatedAt", c.updatedAt),
              dayField("archivedAt", "privacy.f.archivedAt", c.archivedAt),
              dayField("processingRestrictedAt", "privacy.f.restrictedAt", c.processingRestrictedAt),
              field("restrictionNote", "privacy.f.restrictionNote", c.restrictionNote),
              dayField("anonymizedAt", "privacy.f.anonymizedAt", c.anonymizedAt),
            ],
          ],
        },
      ];
    },
  },
];
