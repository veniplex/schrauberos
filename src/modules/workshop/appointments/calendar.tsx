import clsx from "clsx";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { STATUS_TONE } from "./status-tone";
import { Card, EmptyState, Plate, StatusBadge } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { SegmentedLinks } from "@/components/ui/segmented";
import type { Translator } from "@/i18n/translate";
import { isHexColor } from "@/lib/color";
import { toDateInput } from "@/lib/dates";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { weekdayKey, type OpeningHours } from "@/lib/opening-hours";
import { addDays, dayKey, getDate, getISOWeek, instantOf, isSameDay, minutesOfDay, startOfDay, startOfWeek, wallOf } from "@/lib/zone";
import type { AppointmentRow } from "./queries";
import { assignLanes, eventSpanOnDay, eventSurface, initialSlot, overlapsDay } from "./calendar-layout";
import { quickStatusOptions } from "./domain";
import { AppointmentQuickStatus } from "./appointment-quick-status";
import { SlotGrid } from "./slot-grid";

export type CalendarView = "week" | "day" | "list";

/**
 * Der Werkstattkalender in zwei Darstellungen, die **per CSS** umgeschaltet werden (beide stehen im Markup, eine ist `display: none`):
 *
 *  - ab `md` (768 px): das Zeitraster – Woche (Spalte je Tag) und Tag (Spalte je Arbeitsplatz) mit klebendem Tageskopf und klebender Zeitspalte;
 *  - darunter: ein Wochenstreifen (klebt unter der Kopfzeile) und die Termine des gewählten Tages als **Karten** – Lesen, Tippen und „Starten“/„Fertig“ ohne Raster.
 *  Die Liste zeigt immer Karten (je Tag ein klebender Kopf).
 *
 * **Kleben (`sticky`) funktioniert nur, wenn kein Vorfahr `overflow` setzt** (sonst wird der Vorfahr zum Bezugspunkt, und nichts klebt an der Kopfzeile): Raster, Karten und
 * Wochenstreifen liegen deshalb ohne Überlauf-Hülle in der Seite (`html`/`body` kürzen nur mit `overflow-x: clip`, das keinen Bezugspunkt bildet). Ausnahme: Tagesansicht mit
 * mehr als sechs Arbeitsplätzen – dort scrollt das Raster seitlich, der Tageskopf klebt dann nur am Raster statt an der Seite. Die Höhe der Kopfzeile steht im Token `--sticky-top`.
 */
const HOUR_PX = 56;
/** Mehr Spalten als hier scrollen seitlich (Tagesansicht mit vielen Arbeitsplätzen) */
const MAX_FIT_COLUMNS = 6;

type Ctx = {
  i18n: Translator;
  view: CalendarView;
  date: Date;
  canCreate: boolean;
  canEdit: boolean;
  /** Darf Reifensätze ein-/ausbuchen (Recht `tires.stock`, nur bei aktiver Reifenfunktion): Vorschlag nach „Fertig“ */
  canStock: boolean;
  hours: OpeningHours;
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: number;
  now: Date;
};

export function calendarHref(view: CalendarView, date: Date, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ view, date: toDateInput(date), ...extra });
  return `/appointments?${p.toString()}`;
}

/** Wohin ein Termin führt: mit dem Recht zum Bearbeiten ins Formular, sonst in die Leseansicht (`?show=`). */
export const appointmentOpenParams = (id: string, canEdit: boolean): Record<string, string> => (canEdit ? { edit: id } : { show: id });

/* ───────────── Zeit → Pixel ───────────── */

/**
 * Pixel je Minute (`--min-px`) am Raster: Desktop 56 px je Stunde; bei Touch (`--tap-row` = 44 px) wächst es, bis ein Rasterschritt mindestens 44 px hoch ist – so bleibt jedes
 * Zeitfenster und jeder Termin antippbar. Alles Weitere (Lage, Höhe, Stundenlinien) rechnet in CSS damit.
 */
const gridVars = (slotMinutes: number) => ({ "--min-px": `max(calc(var(--tap-row) / ${slotMinutes}), ${HOUR_PX / 60}px)` }) as CSSProperties;
const px = (minutes: number) => `calc(var(--min-px) * ${minutes})`;

function eventColor(a: AppointmentRow) {
  return a.type && isHexColor(a.type.color) ? a.type.color : "var(--accent)";
}
const customerOf = (a: AppointmentRow) => (a.vehicle ? customerDisplayName(a.vehicle.customer) : a.customer ? customerDisplayName(a.customer) : "");
/** „08:00–09:30“; endet der Termin erst am Folgetag (nach Mitternacht), steht das dabei – ein Ende genau um 00:00 Uhr zählt noch zum Starttag. */
const timeRange = (i18n: Translator, a: AppointmentRow) => {
  const range = `${i18n.date(a.startsAt, { timeStyle: "short" })}–${i18n.date(a.endsAt, { timeStyle: "short" })}`;
  return dayKey(new Date(a.endsAt.getTime() - 1)) === dayKey(a.startsAt) ? range : `${range} ${i18n.t("appointments.nextDay")}`;
};
const inactiveStatus = (a: AppointmentRow) => a.status === "cancelled" || a.status === "no_show";

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
        <LinkButton size="icon" href={calendarHref(view, addDays(date, -step))} aria-label={t("common.previous")}>
          <ChevronLeft className="size-4" aria-hidden />
        </LinkButton>
        <LinkButton href={calendarHref(view, startOfDay(new Date()))}>{t("common.today")}</LinkButton>
        <LinkButton size="icon" href={calendarHref(view, addDays(date, step))} aria-label={t("common.next")}>
          <ChevronRight className="size-4" aria-hidden />
        </LinkButton>
      </div>
      <h2 className="min-w-0 flex-1 basis-48 text-base font-semibold tabular">{label}</h2>
      <SegmentedLinks
        label={t("appointments.view")}
        options={(["week", "day", "list"] as const).map((v) => ({ href: calendarHref(v, date), label: t(`appointments.views.${v}`), active: view === v }))}
      />
      {canCreate ? (
        <LinkButton variant="primary" href={calendarHref(view, date, { new: "1" })}>
          {t("appointments.new")}
        </LinkButton>
      ) : null}
    </div>
  );
}

/* ───────────── Termin-Block im Raster ───────────── */

function AppointmentBlock({ a, ctx, startMin, spanStart, spanEnd, lane, lanes }: { a: AppointmentRow; ctx: Ctx; startMin: number; spanStart: number; spanEnd: number; lane: number; lanes: number }) {
  const { i18n } = ctx;
  const color = eventColor(a);
  const inactive = inactiveStatus(a);
  const customer = customerOf(a);
  const time = timeRange(i18n, a);
  const status = i18n.td(`enums.appointmentStatus.${a.status}`, a.status);
  const style = {
    top: px(spanStart - startMin),
    // mindestens 22 px; bei Touch trägt der Rasterschritt (Dauer ≥ ein Schritt, siehe `eventSpan`) die 44 px
    height: `max(${px(spanEnd - spanStart)}, 22px)`,
    left: `calc(${(lane / lanes) * 100}% + 2px)`,
    width: `calc(${100 / lanes}% - 4px)`,
    "--evt": color,
    backgroundColor: eventSurface(color),
  } as CSSProperties;
  const tooltip = [time, a.title, a.vehicle?.plate, customer, a.notes].filter(Boolean).join(" · ");
  const quick = ctx.canEdit && (quickStatusOptions(a.status).length > 0 || Boolean(a.tireSet));

  return (
    <div
      style={style}
      className={clsx(
        "group absolute z-10 rounded-md border border-l-4 text-xs leading-tight text-ink",
        "border-[color-mix(in_oklab,var(--evt)_40%,var(--line))] border-l-[var(--evt)]",
        "hover:z-20 hover:shadow-pop focus-within:z-20",
        a.status === "in_progress" && "ring-1 ring-accent",
      )}
    >
      {/* ein Link, dessen Fläche den ganzen Block deckt (`after`): Schnellstatus-Knöpfe können darüber liegen, ohne in einem Link zu stehen */}
      <Link
        href={calendarHref(ctx.view, ctx.date, appointmentOpenParams(a.id, ctx.canEdit))}
        title={tooltip}
        className="block h-full min-h-0 scroll-mt-16 overflow-hidden rounded-[inherit] px-1.5 py-1 after:absolute after:inset-0 after:rounded-[inherit]"
      >
        <span className="flex items-center gap-1 tabular text-ink-muted">
          {time}
          {a.status === "done" ? <Check className="size-3 shrink-0 text-success-ink" aria-hidden /> : null}
        </span>
        <span className={clsx("block truncate font-medium", inactive && "line-through")}>
          {a.vehicle ? <span className="mr-1 font-mono">{a.vehicle.plate}</span> : null}
          {a.title}
        </span>
        {customer ? <span className="block truncate text-ink-muted">{customer}</span> : null}
        {a.notes ? <span className="block truncate text-ink-muted">{a.notes}</span> : null}
        <span className="sr-only">
          , {[time, a.bay?.name, status].filter(Boolean).join(", ")}
          {a.notes ? `. ${a.notes}` : ""}
        </span>
      </Link>
      {quick ? (
        // Mit der Maus beim Überfahren, per Tastatur sobald der Block den Fokus hat; am Handy gibt es die Karten (Wochenstreifen) und den Dialog.
        // `invisible` statt `hidden`: erst mit Hover/Fokus sichtbar und erreichbar; `empty:hidden`, wenn es keinen Schritt gibt (die Komponente rendert dann nichts)
        <div className="invisible absolute bottom-1 right-1 z-10 flex max-w-[calc(100%-0.5rem)] flex-wrap items-center gap-1 rounded-md bg-surface p-1 shadow-pop empty:hidden group-hover:visible group-focus-within:visible">
          <AppointmentQuickStatus a={a} canEdit={ctx.canEdit} canStock={ctx.canStock} i18n={i18n} />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── Zeitraster (Woche und Tag) ───────────── */

type Column = {
  key: string;
  /** Kopf der Spalte (klebt) */
  head: ReactNode;
  /** Zugänglicher Name der Spalte („Montag, 3. Mai“, „Hebebühne 1“) */
  label: string;
  day: Date;
  bayId?: string;
  events: AppointmentRow[];
  closed: boolean;
};

/** Sichtbare Stunden: die des Kalenders, erweitert um das, was die Termine an ihrem jeweiligen Tag belegen (Termine über Mitternacht: am Starttag bis 24:00, am Folgetag ab 0:00). */
function visibleHours(ctx: Ctx, columns: Column[]) {
  let start = ctx.dayStartHour;
  let end = ctx.dayEndHour;
  for (const column of columns) {
    for (const a of column.events) {
      const [s, e] = eventSpanOnDay(a.startsAt, a.endsAt, column.day, ctx.slotMinutes);
      start = Math.min(start, Math.floor(s / 60));
      end = Math.max(end, Math.ceil(e / 60));
    }
  }
  return { startHour: Math.max(0, start), endHour: Math.min(24, Math.max(end, start + 1)) };
}

function TimeColumn({ ctx, startHour, endHour }: { ctx: Ctx; startHour: number; endHour: number }) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  return (
    <div className="sticky left-0 z-20 w-12 shrink-0 bg-surface" style={{ height: px((endHour - startHour) * 60) }} aria-hidden>
      {hours.map((h, i) => (
        <span key={h} className="absolute right-2 -translate-y-1/2 text-xs tabular text-ink-muted" style={{ top: px(i * 60) }}>
          {i === 0 ? "" : ctx.i18n.date(instantOf(2000, 1, 1, h), { hour: "2-digit", minute: "2-digit" })}
        </span>
      ))}
    </div>
  );
}

const HINT_ID = "calendar-grid-hint";

function DayColumn({ ctx, column, col, startHour, endHour, initial }: { ctx: Ctx; column: Column; col: number; startHour: number; endHour: number; initial: { col: number; row: number } }) {
  const startMin = startHour * 60;
  const endMin = endHour * 60;
  const totalMin = endMin - startMin;
  const slots = Math.floor(totalMin / ctx.slotMinutes);
  const positioned = assignLanes(column.events, (a) => {
    const [s, e] = eventSpanOnDay(a.startsAt, a.endsAt, column.day, ctx.slotMinutes);
    return [Math.max(s, startMin), e];
  });
  const nowMin = minutesOfDay(ctx.now);
  const today = isSameDay(column.day, ctx.now);

  return (
    <div
      role="group"
      aria-label={column.label}
      aria-describedby={ctx.canCreate ? HINT_ID : undefined}
      className={clsx("relative min-w-0 flex-1 border-l border-line", column.closed && "bg-surface-2/60")}
      style={{
        height: px(totalMin),
        backgroundImage: "linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
        backgroundSize: `100% ${px(60)}`,
      }}
    >
      {positioned.map(({ item: a, lane, lanes }) => {
        const [s, e] = eventSpanOnDay(a.startsAt, a.endsAt, column.day, ctx.slotMinutes);
        const spanStart = Math.max(s, startMin);
        return <AppointmentBlock key={a.id} a={a} ctx={ctx} startMin={startMin} spanStart={spanStart} spanEnd={Math.min(e, endMin)} lane={lane} lanes={lanes} />;
      })}

      {ctx.canCreate
        ? Array.from({ length: slots }, (_, i) => {
            // Wandzeit des Rasterfensters in der Zone der Werkstatt (Tag der Spalte + Minuten ab Mitternacht)
            const minutes = startMin + i * ctx.slotMinutes;
            const dayWall = wallOf(column.day);
            const at = instantOf(dayWall.year, dayWall.month, dayWall.day, 0, minutes);
            const params: Record<string, string> = { new: "1", at: `${toDateInput(column.day)}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` };
            if (column.bayId) params.bay = column.bayId;
            return (
              <Link
                key={i}
                href={calendarHref(ctx.view, ctx.date, params)}
                aria-label={ctx.i18n.t("appointments.newAt", { time: ctx.i18n.date(at, { dateStyle: "short", timeStyle: "short" }) })}
                data-slot=""
                data-col={col}
                data-row={i}
                // ein Tab-Stopp für das ganze Raster (Pfeiltasten bewegen ihn, siehe SlotGrid)
                tabIndex={initial.col === col && initial.row === i ? 0 : -1}
                className="absolute inset-x-0 z-0 block scroll-mt-16 hover:bg-accent-subtle focus-visible:bg-accent-subtle focus-visible:-outline-offset-2"
                style={{ top: px(i * ctx.slotMinutes), height: px(ctx.slotMinutes) }}
              />
            );
          })
        : null}

      {today && nowMin >= startMin && nowMin <= endMin ? (
        <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger-ink" style={{ top: px(nowMin - startMin) }} aria-hidden />
      ) : null}
    </div>
  );
}

function TimeGrid({ ctx, columns }: { ctx: Ctx; columns: Column[] }) {
  const { startHour, endHour } = visibleHours(ctx, columns);
  const rows = Math.floor(((endHour - startHour) * 60) / ctx.slotMinutes);
  const initial = initialSlot({ days: columns.map((c) => c.day), now: ctx.now, startMin: startHour * 60, slotMinutes: ctx.slotMinutes, rows });
  const scrollable = columns.length > MAX_FIT_COLUMNS;

  return (
    // `isolate`: eigene Ebene – Termine (z-10) und Jetzt-Linie (z-20) bleiben unter dem klebenden Kopf (z-30), ohne die Kopfzeile der Seite (z-20/30) zu berühren
    <Card as="div" padded={false} className={clsx("isolate", scrollable && "overflow-x-auto")} style={gridVars(ctx.slotMinutes)}>
      {ctx.canCreate ? (
        <p id={HINT_ID} className="sr-only">
          {ctx.i18n.t("appointments.gridHint")}
        </p>
      ) : null}
      <div style={scrollable ? { minWidth: `${columns.length * 10 + 3}rem` } : undefined}>
        <div className="sticky top-(--sticky-top) z-30 flex rounded-t-lg border-b border-line bg-surface">
          <div className="sticky left-0 z-20 w-12 shrink-0 bg-surface" />
          {columns.map((c) => (
            <div key={c.key} className="min-w-0 flex-1 border-l border-line">
              {c.head}
            </div>
          ))}
        </div>
        <SlotGrid className="flex" cols={columns.length} rows={rows}>
          <TimeColumn ctx={ctx} startHour={startHour} endHour={endHour} />
          {columns.map((c, col) => (
            <DayColumn key={c.key} ctx={ctx} column={c} col={col} startHour={startHour} endHour={endHour} initial={initial} />
          ))}
        </SlotGrid>
      </div>
    </Card>
  );
}

/* ───────────── Karten (Handy, Liste) ───────────── */

function AppointmentCard({ a, ctx }: { a: AppointmentRow; ctx: Ctx }) {
  const { i18n } = ctx;
  const color = eventColor(a);
  const inactive = inactiveStatus(a);
  const time = timeRange(i18n, a);
  const status = i18n.td(`enums.appointmentStatus.${a.status}`, a.status);
  const details = [customerOf(a), a.bay?.name, a.assignee?.name].filter(Boolean).join(" · ");

  return (
    <li>
      <Card
        as="article"
        padded={false}
        className="relative border-l-4 p-3 focus-within:ring-2 focus-within:ring-accent-text md:grid md:grid-cols-[8.5rem_minmax(0,1fr)_auto] md:items-center md:gap-x-4"
        style={{ borderLeftColor: color }}
      >
        <p className="tabular text-sm font-medium">{time}</p>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2">
            {a.vehicle ? <Plate>{a.vehicle.plate}</Plate> : null}
            {/* der Link deckt die ganze Karte (`after`); Schnellstatus-Knöpfe liegen darüber (z-10) */}
            <Link
              href={calendarHref(ctx.view, ctx.date, appointmentOpenParams(a.id, ctx.canEdit))}
              className={clsx("inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center font-semibold after:absolute after:inset-0 after:rounded-lg hover:underline", inactive && "text-ink-muted line-through")}
            >
              {a.title}
              <span className="sr-only">
                , {time}, {status}
              </span>
            </Link>
          </p>
          {details ? <p className="text-sm text-ink-muted">{details}</p> : null}
          {a.notes ? <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm">{a.notes}</p> : null}
        </div>
        <div className="relative z-10 mt-2 flex flex-wrap items-center gap-2 md:mt-0 md:justify-end">
          <AppointmentQuickStatus a={a} canEdit={ctx.canEdit} canStock={ctx.canStock} i18n={i18n} />
          <StatusBadge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{status}</StatusBadge>
        </div>
      </Card>
    </li>
  );
}

/** Wochenstreifen: die sieben Tage als Knöpfe (klebt unter der Kopfzeile); der gewählte ist hervorgehoben, die Zahl nennt die Termine des Tages (wenn bekannt). */
function WeekStrip({ ctx, week, view, counts }: { ctx: Ctx; week: Date[]; view: CalendarView; counts?: number[] }) {
  const { i18n } = ctx;
  return (
    <nav
      aria-label={i18n.t("appointments.weekDays")}
      className="sticky top-(--sticky-top) z-20 -mx-4 border-b border-line glass-bar [--glass:var(--bg)] px-4 py-2 sm:-mx-6 sm:px-6"
    >
      <ul className="flex gap-1 overflow-x-auto">
        {week.map((d, i) => {
          const selected = isSameDay(d, ctx.date);
          const today = isSameDay(d, ctx.now);
          const closed = ctx.hours[weekdayKey(d)] === null;
          const count = counts?.[i] ?? 0;
          return (
            <li key={d.toISOString()} className="min-w-11 flex-1">
              <Link
                href={calendarHref(view, d)}
                aria-current={selected ? "true" : undefined}
                className={clsx(
                  "flex min-h-(--tap-row) flex-col items-center rounded-md px-1 py-1.5 text-center",
                  selected ? "bg-accent text-accent-ink" : closed ? "text-ink-muted hover:bg-surface-hover" : "hover:bg-surface-hover",
                  today && !selected && "ring-1 ring-accent-text",
                )}
              >
                <span className="text-xs uppercase tracking-wide">{i18n.date(d, { weekday: "short" })}</span>
                <span className="text-sm font-semibold tabular">{getDate(d)}</span>
                {counts ? (
                  <span className="text-xs tabular">
                    {count > 0 ? (
                      <>
                        <span aria-hidden>{count}</span>
                        <span className="sr-only">, {i18n.tp("appointments.dayCount", count)}</span>
                      </>
                    ) : (
                      <span aria-hidden>&nbsp;</span>
                    )}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Handy-Darstellung von Woche und Tag: Wochenstreifen und die Termine des gewählten Tages als Karten. */
function MobileAgenda({ ctx, events, view }: { ctx: Ctx; events: AppointmentRow[]; view: "week" | "day" }) {
  const { t, tp, date } = ctx.i18n;
  const monday = startOfWeek(ctx.date, { weekStartsOn: 1 });
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayEvents = events.filter((a) => overlapsDay(a, ctx.date));
  // Die Anzahl je Tag kennt nur die Wochenansicht (sie lädt die ganze Woche)
  const counts = view === "week" ? week.map((d) => events.filter((a) => overlapsDay(a, d) && !inactiveStatus(a)).length) : undefined;

  return (
    <div>
      <WeekStrip ctx={ctx} week={week} view={view} counts={counts} />
      <section aria-labelledby="agenda-heading" className="mt-4">
        <h3 id="agenda-heading" className="mb-3 text-sm font-semibold">
          {date(ctx.date, { weekday: "long", day: "numeric", month: "long" })}
          <span className="font-normal text-ink-muted"> · {tp("appointments.dayCount", dayEvents.length)}</span>
        </h3>
        {dayEvents.length === 0 ? (
          <Card as="div" padded={false}>
            <EmptyState title={t("appointments.emptyDay")} />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {dayEvents.map((a) => (
              <AppointmentCard key={a.id} a={a} ctx={ctx} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ───────────── Wochenansicht ───────────── */

export function WeekView({ ctx, events }: { ctx: Ctx; events: AppointmentRow[] }) {
  const monday = startOfWeek(ctx.date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => ctx.hours[weekdayKey(d)] !== null || events.some((a) => overlapsDay(a, d)));
  const columns: Column[] = days.map((d) => {
    const today = isSameDay(d, ctx.now);
    return {
      key: d.toISOString(),
      day: d,
      label: ctx.i18n.date(d, { weekday: "long", day: "numeric", month: "long" }),
      events: events.filter((a) => overlapsDay(a, d)),
      closed: ctx.hours[weekdayKey(d)] === null,
      head: (
        <Link href={calendarHref("day", d)} className="block min-h-(--tap-row) px-2 py-2 text-center hover:bg-surface-hover">
          <span className="block text-xs uppercase tracking-wide text-ink-muted">{ctx.i18n.date(d, { weekday: "short" })}</span>
          <span className={clsx("mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-sm font-semibold tabular", today && "bg-accent text-accent-ink")}>{getDate(d)}</span>
          <span className="sr-only">, {ctx.i18n.t("appointments.views.day")}</span>
        </Link>
      ),
    };
  });

  return (
    <>
      <div className="md:hidden">
        <MobileAgenda ctx={ctx} events={events} view="week" />
      </div>
      <div className="hidden md:block">
        <TimeGrid ctx={ctx} columns={columns} />
      </div>
    </>
  );
}

/* ───────────── Tagesansicht (Spalten = Arbeitsplätze) ───────────── */

export function DayView({ ctx, events, bays }: { ctx: Ctx; events: AppointmentRow[]; bays: Array<{ id: string; name: string }> }) {
  const unassigned = events.filter((a) => !a.bayId || !bays.some((b) => b.id === a.bayId));
  const closed = ctx.hours[weekdayKey(ctx.date)] === null;
  const sources: Array<{ id?: string; name: string; events: AppointmentRow[] }> = [
    ...bays.map((b) => ({ id: b.id, name: b.name, events: events.filter((a) => a.bayId === b.id) })),
    ...(unassigned.length || bays.length === 0 ? [{ name: ctx.i18n.t("appointments.noBay"), events: unassigned }] : []),
  ];
  const columns: Column[] = sources.map((c) => ({
    key: c.id ?? "none",
    day: ctx.date,
    bayId: c.id,
    label: c.name,
    events: c.events,
    closed,
    head: <div className="truncate px-2 py-2.5 text-center text-sm font-medium">{c.name}</div>,
  }));

  return (
    <>
      <div className="md:hidden">
        <MobileAgenda ctx={ctx} events={events} view="day" />
      </div>
      <div className="hidden md:block">
        <TimeGrid ctx={ctx} columns={columns} />
      </div>
    </>
  );
}

/* ───────────── Listenansicht ───────────── */

export function ListView({ ctx, events }: { ctx: Ctx; events: AppointmentRow[] }) {
  const { t } = ctx.i18n;
  if (events.length === 0) {
    return (
      <Card as="div" padded={false}>
        <EmptyState title={t("appointments.emptyList")} />
      </Card>
    );
  }
  const groups = new Map<string, AppointmentRow[]>();
  for (const a of events) {
    const key = toDateInput(a.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()].map(([key, items]) => (
        <section key={key} aria-labelledby={`day-${key}`}>
          {/* klebt unter der Kopfzeile, solange man durch die Karten des Tages scrollt */}
          <h3 id={`day-${key}`} className="sticky top-(--sticky-top) z-20 -mx-4 glass-bar [--glass:var(--bg)] px-4 py-2 text-sm font-semibold sm:-mx-6 sm:px-6 md:mx-0 md:px-0">
            {ctx.i18n.date(items[0].startsAt, { weekday: "long", day: "numeric", month: "long" })}
          </h3>
          <ul className="mt-2 flex flex-col gap-3">
            {items.map((a) => (
              <AppointmentCard key={a.id} a={a} ctx={ctx} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export type { Ctx as CalendarCtx };
