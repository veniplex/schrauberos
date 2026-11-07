import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import { Card, EmptyState, Plate, TextLink, StatusBadge } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { getSession } from "@/server/auth/session";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { toDateInput } from "@/lib/dates";
import { AppointmentQuickStatus } from "./appointment-quick-status";
import { calendarHref } from "./calendar";
import { appointmentsBetween } from "./queries";
import { STATUS_TONE } from "./status-tone";
import type { WidgetDef } from "@/modules/types";

/** Alle Termine des heutigen Tages – jede Zeile führt zum Termin, „Starten“/„Fertig“ gehen direkt von hier. */
export async function TodayAppointmentsWidget() {
  const i18n = await getI18n();
  const { t, tp, td, date } = i18n;
  const session = await getSession();
  const canEdit = session?.can("appointments.edit") ?? false;
  const canStock = session?.can("tires.stock") ?? false;
  const today = startOfDay(new Date());
  const events = await appointmentsBetween(today, addDays(today, 1));
  const open = events.filter((a) => a.status !== "cancelled" && a.status !== "no_show");

  return (
    <Card headingLevel={3}
      title={t("appointments.widgets.todayTitle")}
      actions={
        <TextLink href={`/appointments?view=day&date=${toDateInput(today)}`} className="text-sm">
          {t("appointments.widgets.toCalendar")}
        </TextLink>
      }
      padded={false}
    >
      {open.length === 0 ? (
        <EmptyState title={t("appointments.widgets.todayEmpty")} />
      ) : (
        <>
          <p className="px-5 pt-3 text-sm text-ink-muted">{tp("appointments.widgets.todayCount", open.length)}</p>
          <ul className="divide-y divide-line">
            {open.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <Link
                  href={calendarHref("day", a.startsAt, canEdit ? { edit: a.id } : {})}
                  className="flex min-h-(--tap-row) min-w-0 flex-1 basis-60 items-center gap-4 hover:underline"
                >
                  <span className="w-24 shrink-0 text-sm font-medium tabular">
                    {date(a.startsAt, { timeStyle: "short" })}–{date(a.endsAt, { timeStyle: "short" })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      {a.vehicle ? <Plate>{a.vehicle.plate}</Plate> : null}
                      <span className="truncate text-sm font-medium">{a.title}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {[a.vehicle ? customerDisplayName(a.vehicle.customer) : "", a.bay?.name, a.assignee?.name].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </Link>
                <span className="flex flex-wrap items-center gap-2">
                  <AppointmentQuickStatus a={a} canEdit={canEdit} canStock={canStock} i18n={i18n} />
                  <StatusBadge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{td(`enums.appointmentStatus.${a.status}`, a.status)}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [
  { id: "today-appointments", feature: "workshop.appointments", permission: "appointments.view", span: 2, order: 10, Component: TodayAppointmentsWidget },
];
