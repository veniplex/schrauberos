import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import { Badge, Card, EmptyState, Plate } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { toDateInput } from "@/lib/dates";
import { appointmentsBetween } from "./queries";
import { STATUS_TONE } from "./status-tone";
import type { WidgetDef } from "@/modules/types";

/** Alle Termine des heutigen Tages. */
export async function TodayAppointmentsWidget() {
  const { t, tp, td, date } = await getI18n();
  const today = startOfDay(new Date());
  const events = await appointmentsBetween(today, addDays(today, 1));
  const open = events.filter((a) => a.status !== "cancelled" && a.status !== "no_show");

  return (
    <Card
      title={t("appointments.widgets.todayTitle")}
      actions={
        <Link href={`/appointments?view=day&date=${toDateInput(today)}`} className="text-sm text-accent-text inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
          {t("appointments.widgets.toCalendar")}
        </Link>
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
              <li key={a.id} className="flex items-center gap-4 px-5 py-3">
                <span className="w-24 shrink-0 text-sm font-medium tabular">
                  {date(a.startsAt, { timeStyle: "short" })}–{date(a.endsAt, { timeStyle: "short" })}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.vehicle ? <Plate>{a.vehicle.plate}</Plate> : null}
                    <span className="truncate text-sm font-medium">{a.title}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {[a.vehicle ? customerDisplayName(a.vehicle.customer) : "", a.bay?.name, a.assignee?.name].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{td(`enums.appointmentStatus.${a.status}`, a.status)}</Badge>
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
