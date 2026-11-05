import "server-only";
import { db } from "@/server/db";

export const appointmentInclude = {
  type: true,
  bay: true,
  customer: true,
  vehicle: { include: { customer: true } },
  assignee: { select: { id: true, name: true } },
} as const;

export function appointmentsBetween(from: Date, to: Date) {
  return db.appointment.findMany({
    where: { startsAt: { gte: from, lt: to } },
    include: appointmentInclude,
    orderBy: { startsAt: "asc" },
  });
}

export type AppointmentRow = Awaited<ReturnType<typeof appointmentsBetween>>[number];

/** Stammdaten für das Termin-Formular. */
export async function appointmentFormOptions() {
  const [types, bays, users] = await Promise.all([
    db.appointmentType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.bay.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { types, bays, users };
}
