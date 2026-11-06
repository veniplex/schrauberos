import type { Metadata } from "next";
import { addDays, startOfWeek } from "date-fns";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { parseDateParam, toDateInput } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getWorkshop } from "@/server/workshop";
import { getAppointmentSettings } from "@/modules/workshop/appointments/settings";
import { AppointmentModal } from "@/modules/workshop/appointments/appointment-modal";
import { appointmentsBetween } from "@/modules/workshop/appointments/queries";
import {
  CalendarToolbar,
  DayView,
  ListView,
  WeekView,
  calendarHref,
  type CalendarCtx,
  type CalendarView,
} from "@/modules/workshop/appointments/calendar";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.appointments") };
}

type SearchParams = {
  view?: string;
  date?: string;
  new?: string;
  edit?: string;
  at?: string;
  bay?: string;
  tireSet?: string;
  vehicle?: string;
};

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("appointments.view");
  const sp = await searchParams;
  const [i18n, workshop, settings] = await Promise.all([getI18n(), getWorkshop(), getAppointmentSettings()]);

  const view: CalendarView = sp.view === "day" || sp.view === "list" ? sp.view : "week";
  const date = parseDateParam(sp.date);
  const from = view === "week" ? startOfWeek(date, { weekStartsOn: 1 }) : date;
  const to = addDays(from, view === "week" ? 7 : view === "day" ? 1 : 14);

  const [events, bays] = await Promise.all([
    appointmentsBetween(from, to),
    db.bay.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  const canCreate = session.can("appointments.create");
  const canEdit = session.can("appointments.edit");
  const ctx: CalendarCtx = {
    i18n,
    view,
    date,
    canCreate,
    canEdit,
    hours: workshop.hours,
    dayStartHour: settings.dayStartHour,
    dayEndHour: settings.dayEndHour,
    slotMinutes: settings.slotMinutes,
    now: new Date(),
  };

  const closeHref = calendarHref(view, date);
  const showModal = (sp.edit && canEdit) || (sp.new && canCreate);

  return (
    <>
      <PageHeader title={i18n.t("appointments.title")} description={i18n.t("appointments.description")} />
      <CalendarToolbar i18n={i18n} view={view} date={date} canCreate={canCreate} />
      {view === "week" ? <WeekView ctx={ctx} events={events} /> : null}
      {view === "day" ? <DayView ctx={ctx} events={events} bays={bays} /> : null}
      {view === "list" ? <ListView ctx={ctx} events={events} /> : null}

      {showModal ? (
        <AppointmentModal
          // Neuer Schlüssel je Termin/Slot, damit das Dialogfenster und das Formular frisch initialisiert werden
          key={`${sp.edit ?? "new"}-${sp.at ?? ""}-${sp.tireSet ?? ""}`}
          params={{ edit: sp.edit, at: sp.at, bay: sp.bay, tireSet: sp.tireSet, vehicle: sp.vehicle, date: toDateInput(date) }}
          closeHref={closeHref}
          canDelete={session.can("appointments.delete")}
        />
      ) : null}
    </>
  );
}
