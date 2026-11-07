import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { parseDateParam, toDateInput } from "@/lib/dates";
import { addDays, startOfWeek } from "@/lib/zone";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getWorkshop } from "@/server/workshop";
import { PageSections } from "@/modules/page-sections";
import { getAppointmentSettings } from "@/modules/workshop/appointments/settings";
import { AppointmentDetail } from "@/modules/workshop/appointments/appointment-detail";
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
  /** Leseansicht eines Termins (für alle mit Kalenderzugriff) */
  show?: string;
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

  // Raster (Woche, Tag): auch Termine, die vor dem Zeitraum begonnen haben und über Mitternacht hineinreichen; die Liste zeigt jeden Termin an seinem Starttag
  const events = await appointmentsBetween(from, to, { overlapping: view !== "list" });
  // Archivierte Arbeitsplätze bekommen nur dann eine Spalte, wenn in diesem Zeitraum Termine an ihnen hängen
  const usedBayIds = [...new Set(events.flatMap((a) => (a.bayId ? [a.bayId] : [])))];
  const bays = await db.bay.findMany({ where: { OR: [{ active: true }, { id: { in: usedBayIds } }] }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });

  const canCreate = session.can("appointments.create");
  const canEdit = session.can("appointments.edit");
  const ctx: CalendarCtx = {
    i18n,
    view,
    date,
    canCreate,
    canEdit,
    canStock: session.can("tires.stock"),
    hours: workshop.hours,
    dayStartHour: settings.dayStartHour,
    dayEndHour: settings.dayEndHour,
    slotMinutes: settings.slotMinutes,
    now: new Date(),
  };

  const closeHref = calendarHref(view, date);
  const showModal = (sp.edit && canEdit) || (sp.new && canCreate);
  const showDetail = !showModal && sp.show;

  return (
    <>
      <PageHeader
        help="workshop.appointments"
        title={i18n.t("appointments.title")}
        description={i18n.t("appointments.description")}
        actions={
          session.can("appointments.configure") ? (
            <LinkButton href="/settings?tab=appointments" variant="ghost">
              <Settings className="size-4" aria-hidden /> {i18n.t("appointments.settings.open")}
            </LinkButton>
          ) : null
        }
      />
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
      {showDetail ? <AppointmentDetail key={sp.show} id={sp.show!} view={view} date={date} canEdit={canEdit} sections={<PageSections session={session} host="appointments/detail" entityId={sp.show!} />} /> : null}
    </>
  );
}
