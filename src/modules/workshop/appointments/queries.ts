import "server-only";
import { getHolidays } from "@/server/holidays";
import { getWorkshop } from "@/server/workshop";
import { db } from "@/server/db";
import { appointmentWindow } from "./domain";
import { buildAppointmentHints, touchedDays, type AppointmentHint, type HintBooking } from "./hints";
import { staffWithAccount, userAbsentBetween } from "@/modules/office/employees/public";
import type { Viewer } from "@/modules/types";
import { customerNameSelect } from "@/modules/workshop/customers/public";

export const appointmentInclude = {
  type: true,
  bay: true,
  customer: { select: customerNameSelect },
  vehicle: { include: { customer: { select: customerNameSelect } } },
  assignee: { select: { id: true, name: true } },
  // Verknüpfter Reifensatz: nur, was der Vorschlag „Satz ein-/ausbuchen?“ nach „Fertig“ braucht (Stand, Version, Bezeichnung)
  tireSet: {
    select: { id: true, status: true, season: true, brand: true, width: true, aspect: true, rim: true, loadIndex: true, speedIndex: true, updatedAt: true, vehicle: { select: { plate: true } } },
  },
} as const;

/**
 * Termine im Zeitraum [from, to). Standard: wer **beginnt** im Zeitraum. Mit `overlapping` zählt auch, wer vorher begonnen hat und noch hineinreicht (Termine über
 * Mitternacht erscheinen am Folgetag weiter) – so rechnet das Zeitraster von Woche und Tag.
 */
export function appointmentsBetween(from: Date, to: Date, options: { overlapping?: boolean } = {}) {
  return db.appointment.findMany({
    where: options.overlapping ? { startsAt: { lt: to }, endsAt: { gt: from } } : { startsAt: { gte: from, lt: to } },
    include: appointmentInclude,
    orderBy: { startsAt: "asc" },
  });
}

export type AppointmentRow = Awaited<ReturnType<typeof appointmentsBetween>>[number];

/**
 * Stammdaten für das Termin-Formular. `employees`: Ist die Funktion „Mitarbeiter“ aktiv, besteht die Auswahl „Zuständig“ aus den Mitarbeitern mit Konto statt aus allen
 * Benutzerkonten. `assigneeId`: der bisher Zuständige bleibt immer wählbar (auch ohne Mitarbeitereintrag), sonst ginge die Zuordnung beim Speichern verloren.
 */
export async function appointmentFormOptions(options: { employees?: boolean; assigneeId?: string | null } = {}) {
  const [types, bays, staff] = await Promise.all([
    db.appointmentType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.bay.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    options.employees ? staffWithAccount() : db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  let users = staff;
  if (options.assigneeId && !users.some((u) => u.id === options.assigneeId)) {
    const current = await db.user.findUnique({ where: { id: options.assigneeId }, select: { id: true, name: true } });
    if (current) users = [...users, current];
  }
  return { types, bays, users };
}

/**
 * Hinweise für das Terminformular (`GET /api/appointments/hints`): Feiertag, Öffnungszeiten, Mitternacht, Abwesenheit und weitere Termine des Zuständigen, Fahrzeug mit Termin.
 * Verlangt `appointments.create` oder `appointments.edit`. Abwesenheit kommt nur als „ja/nein“ (siehe `userAbsentBetween`), nie mit der Art. null bei ungültigem Zeitfenster.
 */
export async function appointmentHintsFor(
  viewer: Pick<Viewer, "can"> & { features: ReadonlySet<string> },
  params: { date: string; time: string; duration: number; assigneeId?: string; vehicleId?: string; id?: string },
): Promise<AppointmentHint[] | null> {
  if (!viewer.can("appointments.create") && !viewer.can("appointments.edit")) throw new Error("appointments.create fehlt");
  const window = appointmentWindow(params.date, params.time, params.duration);
  if (!window) return null;
  const days = touchedDays(window);
  const [workshop, holidays] = await Promise.all([getWorkshop(), getHolidays()]);
  const overlapping = { startsAt: { lt: window.endsAt }, endsAt: { gt: window.startsAt }, ...(params.id ? { id: { not: params.id } } : {}) };
  const select = { title: true, startsAt: true, endsAt: true, status: true } as const;

  const assignee = params.assigneeId ? await db.user.findFirst({ where: { id: params.assigneeId, active: true }, select: { id: true, name: true } }) : null;
  const [absent, assigneeOthers] = assignee
    ? await Promise.all([
        viewer.features.has("office.employees") ? userAbsentBetween(assignee.id, days[0], days[days.length - 1]) : false,
        db.appointment.findMany({ where: { assigneeId: assignee.id, ...overlapping }, select, take: 10 }),
      ])
    : [false, [] as HintBooking[]];

  const vehicle = params.vehicleId ? await db.vehicle.findUnique({ where: { id: params.vehicleId }, select: { id: true, plate: true } }) : null;
  // Termine des Fahrzeugs am selben Kalendertag (nicht nur genau im Zeitfenster): „hat an diesem Tag schon einen Termin“
  const vehicleOthers = vehicle
    ? await db.appointment.findMany({
        where: { vehicleId: vehicle.id, ...(params.id ? { id: { not: params.id } } : {}), startsAt: { lt: new Date(window.endsAt.getTime() + 36 * 3_600_000) }, endsAt: { gt: new Date(window.startsAt.getTime() - 36 * 3_600_000) } },
        select,
        take: 20,
      })
    : [];

  return buildAppointmentHints({
    window,
    hours: workshop.hours,
    holidays,
    assignee: assignee ? { name: assignee.name, absent, others: assigneeOthers } : undefined,
    vehicle: vehicle ? { plate: vehicle.plate, others: vehicleOthers } : undefined,
  });
}

