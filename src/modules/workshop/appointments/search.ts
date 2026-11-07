import "server-only";
import { toDateInput } from "@/lib/dates";
import { normalizePlate } from "@/lib/plate";
import { db } from "@/server/db";
import { contains, FULLTEXT_MIN_LENGTH } from "@/server/search";
import type { SearchProviderDef } from "@/modules/types";

/** Schnellsuche: Termine nach Titel, Notizen (ab 3 Zeichen), Kennzeichen und Kundenname (auch der Halter des Fahrzeugs); der Treffer öffnet den Termin im Kalender an seinem Tag. */
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
            ...(q.length >= FULLTEXT_MIN_LENGTH ? [{ notes: contains(q) }] : []),
            ...(plate ? [{ vehicle: { plateNorm: { contains: plate } } }] : []),
            { customer: { lastName: contains(q) } },
            { customer: { company: contains(q) } },
            { vehicle: { customer: { lastName: contains(q) } } },
            { vehicle: { customer: { company: contains(q) } } },
          ],
        },
        orderBy: { startsAt: "desc" },
        take: limit,
        select: { id: true, title: true, startsAt: true, vehicle: { select: { plate: true } } },
      });
      // Mit dem Recht zum Bearbeiten öffnet der Treffer das Formular, sonst die Leseansicht des Termins
      const canEdit = session.can("appointments.edit");
      return rows.map((a) => {
        const day = toDateInput(a.startsAt);
        return {
          id: a.id,
          title: a.title,
          subtitle: [day, a.vehicle?.plate ?? ""].filter(Boolean).join(" · "),
          href: `/appointments?view=day&date=${day}&${canEdit ? "edit" : "show"}=${a.id}`,
        };
      });
    },
  },
];
