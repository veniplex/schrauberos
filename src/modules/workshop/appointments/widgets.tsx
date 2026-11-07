import Link from "next/link";
import { Card, EmptyState, Plate, TextLink, StatusBadge } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { getSession } from "@/server/auth/session";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { toDateInput } from "@/lib/dates";
import { AppointmentQuickStatus } from "./appointment-quick-status";
import { appointmentOpenParams, calendarHref } from "./calendar";
import { appointmentsBetween } from "./queries";
import { STATUS_TONE } from "./status-tone";
import { addDays, isSameDay, startOfDay } from "@/lib/zone";
import type { WidgetDef } from "@/modules/types";

/**
 * „Heute und morgen“ (P2b-4): die Termine des heutigen und des morgigen Tages, getrennt nach Tag – jede Zeile führt zum Termin, „Starten“/„Fertig“ gehen für heute direkt von hier.
 * Storniert und nicht erschienen zählen nicht.
 */
export async function TodayAppointmentsWidget() {
  const i18n = await getI18n();
  const { t, tp, td, date } = i18n;
  const session = await getSession();
  const canEdit = session?.can("appointments.edit") ?? false;
  const canStock = session?.can("tires.stock") ?? false;
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const events = await appointmentsBetween(today, addDays(today, 2));
  const open = events.filter((a) => a.status !== "cancelled" && a.status !== "no_show");
  const days = [
    { key: "today", day: today, rows: open.filter((a) => isSameDay(a.startsAt, today)), quick: true },
    { key: "tomorrow", day: tomorrow, rows: open.filter((a) => isSameDay(a.startsAt, tomorrow)), quick: false },
  ] as const;

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
        days.map(({ key, day, rows, quick }) => (
          <section key={key} aria-label={t(`appointments.widgets.${key}`)}>
            <p className="px-5 pt-3 text-sm font-medium text-ink-muted">
              {t(`appointments.widgets.${key}`)} · {date(day, { weekday: "long", day: "numeric", month: "long" })} · {tp(`appointments.widgets.${key}Count`, rows.length)}
            </p>
            {rows.length === 0 ? <p className="px-5 pb-3 pt-1 text-sm text-ink-muted">{t(`appointments.widgets.${key}None`)}</p> : null}
            <ul className="divide-y divide-line">
              {rows.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <Link
                    href={calendarHref("day", a.startsAt, appointmentOpenParams(a.id, canEdit))}
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
                    {quick ? <AppointmentQuickStatus a={a} canEdit={canEdit} canStock={canStock} i18n={i18n} /> : null}
                    <StatusBadge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{td(`enums.appointmentStatus.${a.status}`, a.status)}</StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [
  { id: "today-appointments", titleKey: "appointments.widgets.todayTitle", priority: 10, feature: "workshop.appointments", permission: "appointments.view", span: 2, order: 10, Component: TodayAppointmentsWidget },
];
