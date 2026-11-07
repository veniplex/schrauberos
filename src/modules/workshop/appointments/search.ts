import "server-only";
import { toDateInput } from "@/lib/dates";
import { normalizePlate } from "@/lib/plate";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import type { SearchProviderDef } from "@/modules/types";

/** Schnellsuche: Termine nach Titel, Notizen, Kennzeichen und Kundenname; der Treffer öffnet den Termin im Kalender an seinem Tag. */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "appointments",
    feature: "workshop.appointments",
    permission: "appointments.view",
    groupKey: "appointments.search.group",
    order: 10,
    async search(q, { limit, session }) {
      const plate = normalizePlate(q);
      const rows = await db.appointment.findMany({
        where: {
          OR: [
            { title: contains(q) },
            { notes: contains(q) },
            ...(plate ? [{ vehicle: { plateNorm: { contains: plate } } }] : []),
            { customer: { lastName: contains(q) } },
            { customer: { company: contains(q) } },
          ],
        },
        orderBy: { startsAt: "desc" },
        take: limit,
        select: { id: true, title: true, startsAt: true, vehicle: { select: { plate: true } } },
      });
      // Ohne Bearbeiten-Recht öffnet die Kalenderseite den Termin nicht im Dialog: dann nur der Tag
      const canOpen = session.can("appointments.edit");
      return rows.map((a) => {
        const day = toDateInput(a.startsAt);
        return {
          id: a.id,
          title: a.title,
          subtitle: [day, a.vehicle?.plate ?? ""].filter(Boolean).join(" · "),
          href: `/appointments?view=day&date=${day}${canOpen ? `&edit=${a.id}` : ""}`,
        };
      });
    },
  },
];
