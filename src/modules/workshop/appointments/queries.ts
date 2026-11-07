import "server-only";
import { db } from "@/server/db";
import { staffWithAccount } from "@/modules/office/employees/public";
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

export function appointmentsBetween(from: Date, to: Date) {
  return db.appointment.findMany({
    where: { startsAt: { gte: from, lt: to } },
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
