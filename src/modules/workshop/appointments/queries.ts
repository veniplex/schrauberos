import "server-only";
import { getHolidays } from "@/server/holidays";
import { getWorkshop } from "@/server/workshop";
import { db } from "@/server/db";
import { appointmentWindow } from "./domain";
import { buildAppointmentHints, touchedDays, type AppointmentHint, type HintBooking } from "./hints";
import { staffWithAccount, userAbsentBetween } from "@/modules/office/employees/public";
import type { Viewer } from "@/modules/types";
import { customerDisplayName, customerContacts, customerNameSelect, unrestrictedCustomerWhere } from "@/modules/workshop/customers/public";

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
export async function appointmentFormOptions(options: { employees?: boolean; assigneeId?: string | null; typeId?: string | null; bayId?: string | null } = {}) {
  // Archivierte Terminarten und Arbeitsplätze (`active = false`) sind nicht wählbar – außer, der Termin hat sie schon (sonst ginge die Zuordnung beim Speichern verloren)
  const [types, bays, staff] = await Promise.all([
    db.appointmentType.findMany({ where: { OR: [{ active: true }, ...(options.typeId ? [{ id: options.typeId }] : [])] }, orderBy: { sortOrder: "asc" } }),
    db.bay.findMany({ where: { OR: [{ active: true }, ...(options.bayId ? [{ id: options.bayId }] : [])] }, orderBy: { sortOrder: "asc" } }),
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


/**
 * Was der **Terminzettel** (F8) braucht: Zeit, Bezeichnung, Terminart, Fahrzeug, **Anzeigename** des Kunden, Reifensatz (Größe und Saison) – und nur auf Wunsch (`withNotes`) die Notizen des Termins: Sie
 * sind für die Werkstatt geschrieben, der Zettel geht oft an den Kunden. Das **Telefon** des Kunden nur mit `customers.view`. Verlangt `appointments.view`. Termine, deren Kunde oder Fahrzeughalter eingeschränkt
 * verarbeitet wird (Art. 18 DSGVO), gibt es nicht (`null`). Arbeitsplatz und Zuständiger stehen bewusst nicht darauf (interne Planung). Explizites `select`.
 */
export async function appointmentSlipData(viewer: Viewer, id: string, options: { withNotes?: boolean } = {}) {
  if (!viewer.can("appointments.view")) return null;
  const unrestricted = { OR: [{ customerId: null }, { customer: { is: unrestrictedCustomerWhere } }] };
  const a = await db.appointment.findFirst({
    where: { id, AND: [unrestricted, { OR: [{ vehicleId: null }, { vehicle: { is: unrestricted } }] }] },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      ...(options.withNotes ? { notes: true } : {}),
      type: { select: { name: true } },
      customer: { select: customerNameSelect },
      vehicle: { select: { plate: true, make: true, model: true, customer: { select: customerNameSelect } } },
      tireSet: { select: { season: true, width: true, aspect: true, rim: true, loadIndex: true, speedIndex: true } },
    },
  });
  if (!a) return null;
  const owner = a.vehicle?.customer ?? a.customer;
  const phone = owner ? ((await customerContacts(viewer, [owner.id])).get(owner.id)?.phone ?? null) : null;
  const { vehicle, customer: _customer, type, ...rest } = a;
  void _customer;
  return {
    ...rest,
    notes: "notes" in a ? ((a as { notes: string | null }).notes ?? null) : null,
    typeName: type?.name ?? null,
    plate: vehicle?.plate ?? null,
    vehicleName: vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(" ") : "",
    customerName: owner ? customerDisplayName(owner) : null,
    phone,
  };
}

export type AppointmentSlipData = NonNullable<Awaited<ReturnType<typeof appointmentSlipData>>>;

export type FeedAppointment = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  modified: Date;
  typeName: string | null;
  plate: string | null;
  vehicleName: string;
  /** Anzeigename des Kunden – nur mit `customers.view`, sonst `null` (und dann gar nicht gelesen) */
  customerName: string | null;
};

/**
 * Termine für das Kalender-Abo (F10), die den Zeitraum `from`…`to` (Zeitpunkte, `to` ausgeschlossen) berühren, nach Beginn sortiert, höchstens `take`. Verlangt `appointments.view`. **Nur, was ein
 * Kalender außerhalb der Anwendung zeigen darf:** Bezeichnung, Zeit, Status, Terminart, Kennzeichen und Fahrzeug; der **Anzeigename** des Kunden nur mit `customers.view` (sonst werden Kundenspalten gar nicht
 * gelesen); **nie Notizen, Telefon, Arbeitsplatz oder Zuständige**. Termine, deren Kunde oder Fahrzeughalter eingeschränkt verarbeitet wird (Art. 18 DSGVO), gibt es nicht.
 */
export async function appointmentsForFeed(viewer: Viewer, from: Date, to: Date, take: number): Promise<FeedAppointment[]> {
  if (!viewer.can("appointments.view")) return [];
  const withCustomer = viewer.can("customers.view");
  const unrestricted = { OR: [{ customerId: null }, { customer: { is: unrestrictedCustomerWhere } }] };
  const rows = await db.appointment.findMany({
    where: { startsAt: { lt: to }, endsAt: { gt: from }, AND: [unrestricted, { OR: [{ vehicleId: null }, { vehicle: { is: unrestricted } }] }] },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take,
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      updatedAt: true,
      type: { select: { name: true } },
      vehicle: { select: { plate: true, make: true, model: true, ...(withCustomer ? { customer: { select: customerNameSelect } } : {}) } },
      ...(withCustomer ? { customer: { select: customerNameSelect } } : {}),
    },
  });
  return rows.map((a) => {
    const row = a as typeof a & { customer?: Parameters<typeof customerDisplayName>[0] | null; vehicle: ((typeof a)["vehicle"] & { customer?: Parameters<typeof customerDisplayName>[0] | null }) | null };
    const owner = row.vehicle?.customer ?? row.customer ?? null;
    return {
      id: a.id,
      title: a.title,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      status: a.status,
      modified: a.updatedAt,
      typeName: a.type?.name ?? null,
      plate: a.vehicle?.plate ?? null,
      vehicleName: a.vehicle ? [a.vehicle.make, a.vehicle.model].filter(Boolean).join(" ") : "",
      customerName: owner ? customerDisplayName(owner) : null,
    };
  });
}

/** Stand des Kalender-Abos des Benutzers (nie das Token – gespeichert ist nur der Hash): Kennung, Anlage, Ablauf, letzter Abruf. `null`: kein Abo. */
export async function feedStatusOf(userId: string) {
  return db.calendarFeedToken.findUnique({ where: { userId }, select: { hint: true, createdAt: true, expiresAt: true, lastUsedAt: true } });
}

/** So viele Termine liest die Auslastung höchstens (ein Jahr bei mehreren Plätzen bleibt darunter); darüber steht `truncated`. */
export const UTILIZATION_MAX_BOOKINGS = 50_000;

export type UtilizationBooking = { bayId: string | null; startsAt: Date; endsAt: Date };
export type UtilizationSource = { bays: Array<{ id: string; name: string; active: boolean }>; bookings: UtilizationBooking[]; truncated: boolean };

/**
 * Termine für den **Auslastungsbericht** (F9): je Termin nur Arbeitsplatz, Beginn und Ende – kein Titel, kein Kunde, kein Fahrzeug, keine Notiz. Alle Termine, die den Zeitraum `from`…`to` (Zeitpunkte, `to` ausgeschlossen)
 * berühren und nicht abgesagt oder nicht erschienen sind (diese belegen keinen Platz), dazu die Arbeitsplätze (aktive und solche mit Terminen im Zeitraum). Verlangt `appointments.view`.
 */
export async function utilizationSource(viewer: Viewer, from: Date, to: Date): Promise<UtilizationSource | null> {
  if (!viewer.can("appointments.view")) return null;
  const rows = await db.appointment.findMany({
    where: { startsAt: { lt: to }, endsAt: { gt: from }, status: { notIn: ["cancelled", "no_show"] } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: UTILIZATION_MAX_BOOKINGS + 1,
    select: { bayId: true, startsAt: true, endsAt: true },
  });
  const truncated = rows.length > UTILIZATION_MAX_BOOKINGS;
  const bookings = truncated ? rows.slice(0, UTILIZATION_MAX_BOOKINGS) : rows;
  const used = new Set(bookings.flatMap((b) => (b.bayId ? [b.bayId] : [])));
  const bays = await db.bay.findMany({ where: { OR: [{ active: true }, { id: { in: [...used] } }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } });
  return { bays, bookings, truncated };
}
