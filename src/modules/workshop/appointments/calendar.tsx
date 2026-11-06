import clsx from "clsx";
import Link from "next/link";
import type { CSSProperties } from "react";
import { addDays, getISOWeek, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { Check } from "lucide-react";
import { STATUS_TONE } from "./status-tone";
import { Badge, EmptyState, Plate } from "@/components/ui/layout";
import type { Translator } from "@/i18n/translate";
import { isHexColor } from "@/lib/color";
import { toDateInput } from "@/lib/dates";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { weekdayKey, type OpeningHours } from "@/lib/opening-hours";
import type { AppointmentRow } from "./queries";
import { assignLanes } from "./calendar-layout";

export type CalendarView = "week" | "day" | "list";

const HOUR_PX = 56;
type Ctx = {
  i18n: Translator;
  view: CalendarView;
  date: Date;
  canCreate: boolean;
  canEdit: boolean;
  hours: OpeningHours;
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: number;
  now: Date;
};

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

export function calendarHref(view: CalendarView, date: Date, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ view, date: toDateInput(date), ...extra });
  return `/appointments?${p.toString()}`;
}

/* ───────────── Toolbar ───────────── */

export function CalendarToolbar({ i18n, view, date, canCreate }: Pick<Ctx, "i18n" | "view" | "date" | "canCreate">) {
  const { t } = i18n;
  const step = view === "week" ? 7 : view === "day" ? 1 : 14;
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const label =
    view === "week"
      ? `${t("appointments.weekShort", { week: getISOWeek(date) })} · ${i18n.date(weekStart, { day: "numeric", month: "short" })} – ${i18n.date(addDays(weekStart, 6), { day: "numeric", month: "short", year: "numeric" })}`
      : view === "day"
        ? i18n.date(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : `${i18n.date(date, { day: "numeric", month: "short" })} – ${i18n.date(addDays(date, step - 1), { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <Link href={calendarHref(view, addDays(date, -step))} className="btn btn-secondary btn-icon" aria-label={t("common.previous")}>
          ‹
        </Link>
        <Link href={calendarHref(view, startOfDay(new Date()))} className="btn btn-secondary">
          {t("common.today")}
        </Link>
        <Link href={calendarHref(view, addDays(date, step))} className="btn btn-secondary btn-icon" aria-label={t("common.next")}>
          ›
        </Link>
      </div>
      <h2 className="min-w-0 flex-1 text-base font-semibold tabular">{label}</h2>
      <div role="group" aria-label={t("appointments.view")} className="flex gap-0.5 rounded-md bg-surface-2 p-0.5">
        {(["week", "day", "list"] as const).map((v) => (
          <Link
            key={v}
            href={calendarHref(v, date)}
            aria-current={view === v ? "true" : undefined}
            className={clsx(
              "grid min-h-8 place-items-center rounded-sm px-3 text-sm font-medium",
              view === v ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {t(`appointments.views.${v}`)}
          </Link>
        ))}
      </div>
      {canCreate ? (
        <Link href={calendarHref(view, date, { new: "1" })} className="btn btn-primary">
          {t("appointments.new")}
        </Link>
      ) : null}
    </div>
  );
}

/* ───────────── Termin-Block ───────────── */

function AppointmentBlock({
  a,
  ctx,
  top,
  height,
  left,
  width,
}: {
  a: AppointmentRow;
  ctx: Ctx;
  top: number;
  height: number;
  left: number;
  width: number;
}) {
  const color = a.type && isHexColor(a.type.color) ? a.type.color : "var(--accent)";
  const inactive = a.status === "cancelled" || a.status === "no_show";
  const customer = a.vehicle ? customerDisplayName(a.vehicle.customer) : a.customer ? customerDisplayName(a.customer) : "";
  const time = `${ctx.i18n.date(a.startsAt, { timeStyle: "short" })}–${ctx.i18n.date(a.endsAt, { timeStyle: "short" })}`;
  const style = {
    top,
    height,
    left: `calc(${left}% + 2px)`,
    width: `calc(${width}% - 4px)`,
    "--evt": color,
  } as CSSProperties;

  const className = clsx(
    "absolute z-10 overflow-hidden rounded-md border border-l-4 px-1.5 py-1 text-xs leading-tight",
    "border-[color-mix(in_oklab,var(--evt)_40%,var(--line))] border-l-[var(--evt)]",
    "bg-[color-mix(in_oklab,var(--evt)_16%,var(--surface))] text-ink",
    ctx.canEdit && "hover:bg-[color-mix(in_oklab,var(--evt)_26%,var(--surface))]",
    inactive && "opacity-55",
    a.status === "in_progress" && "ring-1 ring-accent",
  );
  const tooltip = [time, a.title, a.vehicle?.plate, customer].filter(Boolean).join(" · ");
  const content = (
    <>
      <span className="flex items-center gap-1 tabular text-[11px] text-ink-muted">
        {time}
        {a.status === "done" ? <Check className="size-3 text-success-ink" aria-label={ctx.i18n.td("enums.appointmentStatus.done")} /> : null}
      </span>
      <span className={clsx("block truncate font-medium", inactive && "line-through")}>
        {a.vehicle ? <span className="mr-1 font-mono">{a.vehicle.plate}</span> : null}
        {a.title}
      </span>
      {customer ? <span className="block truncate text-ink-muted">{customer}</span> : null}
    </>
  );

  return ctx.canEdit ? (
    <Link href={calendarHref(ctx.view, ctx.date, { edit: a.id })} style={style} title={tooltip} className={className}>
      {content}
    </Link>
  ) : (
    <div style={style} title={tooltip} className={className}>
      {content}
    </div>
  );
}

/* ───────────── Spalten mit Zeitraster ───────────── */

function TimeColumn({ ctx, startHour, endHour }: { ctx: Ctx; startHour: number; endHour: number }) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  return (
    <div className="relative w-12 shrink-0" style={{ height: (endHour - startHour) * HOUR_PX }} aria-hidden>
      {hours.map((h, i) => (
        <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular text-ink-muted" style={{ top: i * HOUR_PX }}>
          {i === 0 ? "" : ctx.i18n.date(new Date(2000, 0, 1, h), { hour: "2-digit", minute: "2-digit" })}
        </span>
      ))}
    </div>
  );
}

function DayColumn({
  ctx,
  day,
  events,
  startHour,
  endHour,
  bayId,
  closed,
}: {
  ctx: Ctx;
  day: Date;
  events: AppointmentRow[];
  startHour: number;
  endHour: number;
  bayId?: string;
  closed: boolean;
}) {
  const startMin = startHour * 60;
  const totalMin = (endHour - startHour) * 60;
  const slots = Math.floor(totalMin / ctx.slotMinutes);
  const slotPx = (ctx.slotMinutes / 60) * HOUR_PX;
  const positioned = assignLanes(events, (a) => [
    Math.max(minutesOfDay(a.startsAt), startMin),
    Math.max(minutesOfDay(a.endsAt), minutesOfDay(a.startsAt) + 15),
  ]);
  const isToday = isSameDay(day, ctx.now);
  const nowMin = minutesOfDay(ctx.now);

  return (
    <div
      className={clsx("relative min-w-0 flex-1 border-l border-line", closed && "bg-surface-2/60")}
      style={{
        height: (totalMin / 60) * HOUR_PX,
        backgroundImage: "linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
        backgroundSize: `100% ${HOUR_PX}px`,
      }}
    >
      {ctx.canCreate
        ? Array.from({ length: slots }, (_, i) => {
            const at = new Date(day);
            at.setHours(0, startMin + i * ctx.slotMinutes, 0, 0);
            const params: Record<string, string> = { new: "1", at: `${toDateInput(at)}T${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` };
            if (bayId) params.bay = bayId;
            return (
              <Link
                key={i}
                href={calendarHref(ctx.view, ctx.date, params)}
                aria-label={ctx.i18n.t("appointments.newAt", { time: ctx.i18n.date(at, { dateStyle: "short", timeStyle: "short" }) })}
                className="absolute inset-x-0 z-0 hover:bg-accent-subtle"
                style={{ top: i * slotPx, height: slotPx }}
                tabIndex={-1}
              />
            );
          })
        : null}

      {positioned.map(({ item: a, lane, lanes }) => {
        const s = Math.max(minutesOfDay(a.startsAt), startMin);
        const e = Math.min(Math.max(minutesOfDay(a.endsAt), s + 15), endHour * 60);
        return (
          <AppointmentBlock
            key={a.id}
            a={a}
            ctx={ctx}
            top={((s - startMin) / 60) * HOUR_PX}
            height={Math.max(((e - s) / 60) * HOUR_PX, 22)}
            left={(lane / lanes) * 100}
            width={100 / lanes}
          />
        );
      })}

      {isToday && nowMin >= startMin && nowMin <= endHour * 60 ? (
        <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger-ink" style={{ top: ((nowMin - startMin) / 60) * HOUR_PX }} aria-hidden />
      ) : null}
    </div>
  );
}

function visibleHours(ctx: Ctx, events: AppointmentRow[]) {
  let start = ctx.dayStartHour;
  let end = ctx.dayEndHour;
  for (const a of events) {
    start = Math.min(start, a.startsAt.getHours());
    end = Math.max(end, a.endsAt.getHours() + (a.endsAt.getMinutes() > 0 ? 1 : 0));
  }
  return { startHour: Math.max(0, start), endHour: Math.min(24, Math.max(end, start + 1)) };
}

/* ───────────── Wochenansicht ───────────── */

export function WeekView({ ctx, events }: { ctx: Ctx; events: AppointmentRow[] }) {
  const monday = startOfWeek(ctx.date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter(
    (d) => ctx.hours[weekdayKey(d)] !== null || events.some((a) => isSameDay(a.startsAt, d)),
  );
  const { startHour, endHour } = visibleHours(ctx, events);

  return (
    <div className="card overflow-x-auto">
      <div className="min-w-[44rem]">
        <div className="flex border-b border-line">
          <div className="w-12 shrink-0" />
          {days.map((d) => {
            const today = isSameDay(d, ctx.now);
            return (
              <Link
                key={d.toISOString()}
                href={calendarHref("day", d)}
                className="min-w-0 flex-1 border-l border-line px-2 py-2 text-center hover:bg-surface-hover"
              >
                <span className="block text-xs uppercase tracking-wide text-ink-muted">{ctx.i18n.date(d, { weekday: "short" })}</span>
                <span className={clsx("mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-sm font-semibold tabular", today && "bg-accent text-accent-ink")}>
                  {d.getDate()}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="flex">
          <TimeColumn ctx={ctx} startHour={startHour} endHour={endHour} />
          {days.map((d) => (
            <DayColumn
              key={d.toISOString()}
              ctx={ctx}
              day={d}
              startHour={startHour}
              endHour={endHour}
              events={events.filter((a) => isSameDay(a.startsAt, d))}
              closed={ctx.hours[weekdayKey(d)] === null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Tagesansicht (Spalten = Arbeitsplätze) ───────────── */

export function DayView({ ctx, events, bays }: { ctx: Ctx; events: AppointmentRow[]; bays: Array<{ id: string; name: string }> }) {
  const unassigned = events.filter((a) => !a.bayId || !bays.some((b) => b.id === a.bayId));
  const columns: Array<{ id?: string; name: string; events: AppointmentRow[] }> = [
    ...bays.map((b) => ({ id: b.id, name: b.name, events: events.filter((a) => a.bayId === b.id) })),
    ...(unassigned.length || bays.length === 0 ? [{ name: ctx.i18n.t("appointments.noBay"), events: unassigned }] : []),
  ];
  const { startHour, endHour } = visibleHours(ctx, events);
  const closed = ctx.hours[weekdayKey(ctx.date)] === null;

  return (
    <div className="card overflow-x-auto">
      <div style={{ minWidth: `${Math.max(columns.length * 11, 22)}rem` }}>
        <div className="flex border-b border-line">
          <div className="w-12 shrink-0" />
          {columns.map((c) => (
            <div key={c.id ?? "none"} className="min-w-0 flex-1 truncate border-l border-line px-2 py-2.5 text-center text-sm font-medium">
              {c.name}
            </div>
          ))}
        </div>
        <div className="flex">
          <TimeColumn ctx={ctx} startHour={startHour} endHour={endHour} />
          {columns.map((c) => (
            <DayColumn key={c.id ?? "none"} ctx={ctx} day={ctx.date} startHour={startHour} endHour={endHour} events={c.events} bayId={c.id} closed={closed} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Listenansicht ───────────── */

export function ListView({ ctx, events }: { ctx: Ctx; events: AppointmentRow[] }) {
  const { t, td } = ctx.i18n;
  if (events.length === 0) {
    return (
      <div className="card">
        <EmptyState title={t("appointments.emptyList")} />
      </div>
    );
  }
  const groups = new Map<string, AppointmentRow[]>();
  for (const a of events) {
    const key = toDateInput(a.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([key, items]) => (
        <section key={key} className="card overflow-hidden">
          <h3 className="border-b border-line bg-surface-2 px-4 py-2 text-sm font-semibold">
            {ctx.i18n.date(items[0].startsAt, { weekday: "long", day: "numeric", month: "long" })}
          </h3>
          <div className="overflow-x-auto">
            <table className="table">
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="row-link">
                    <td className="w-32 whitespace-nowrap tabular">
                      {ctx.canEdit ? (
                        <Link href={calendarHref(ctx.view, ctx.date, { edit: a.id })} className="font-medium hover:underline">
                          {ctx.i18n.date(a.startsAt, { timeStyle: "short" })}–{ctx.i18n.date(a.endsAt, { timeStyle: "short" })}
                        </Link>
                      ) : (
                        <span className="font-medium">
                          {ctx.i18n.date(a.startsAt, { timeStyle: "short" })}–{ctx.i18n.date(a.endsAt, { timeStyle: "short" })}
                        </span>
                      )}
                    </td>
                    <td>
                      {a.vehicle ? <Plate>{a.vehicle.plate}</Plate> : null}
                      <span className="ml-2">{a.vehicle ? customerDisplayName(a.vehicle.customer) : a.customer ? customerDisplayName(a.customer) : ""}</span>
                    </td>
                    <td>{a.title}</td>
                    <td className="text-ink-muted">{a.bay?.name}</td>
                    <td className="text-ink-muted">{a.assignee?.name}</td>
                    <td className="text-right">
                      <Badge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{td(`enums.appointmentStatus.${a.status}`, a.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export type { Ctx as CalendarCtx };
