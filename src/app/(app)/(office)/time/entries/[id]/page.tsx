import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Card, DefinitionList, StatusBadge, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { getI18n } from "@/i18n/server";
import { toDateInput, toTimeInput } from "@/lib/dates";
import { entryMinutes, formatDuration } from "@/modules/office/time/domain";
import { CorrectForm, VoidForm } from "@/modules/office/time/entry-forms";
import { getEntry } from "@/modules/office/time/queries";
import { stampableOrders } from "@/modules/workshop/orders/public";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  if (!(await sessionIfAllowed("time.view"))) return {};
  return { title: t("time.entry.title") };
}

/** Ein Zeiteintrag mit Korrekturverlauf (der Stand vor jeder Änderung mit Begründung) und – mit Recht – Korrigieren und Stornieren. */
export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("time.view");
  const [{ id }, { t, td, date, number }] = await Promise.all([params, getI18n()]);
  const entry = await getEntry(session, id);
  if (!entry) notFound();
  const workshop = await getWorkshop();
  const now = new Date();
  const minutes = entryMinutes(entry, now);
  const mayChange = session.can("time.correct") && (entry.own || session.can("time.correctAll")) && !entry.voided && !entry.transferred;
  const orders = mayChange && session.features.has("workshop.orders") && session.can("orders.view") ? await stampableOrders() : [];
  const orderOptions = orders.map((o) => ({ id: o.id, label: `${o.number} · ${o.plate}` }));
  if (entry.orderId && entry.orderNumber && !orderOptions.some((o) => o.id === entry.orderId)) orderOptions.unshift({ id: entry.orderId, label: [entry.orderNumber, entry.plate].filter(Boolean).join(" · ") });

  const timeLabel = (d: Date | null) => (d ? date(d, { dateStyle: "medium", timeStyle: "short" }) : t("time.running"));
  const history: TimelineItem[] = entry.corrections.map((c) => ({
    id: c.id,
    title: td(`time.correction.${c.kind}`, c.kind),
    description:
      c.kind === "create"
        ? `${c.byName} · ${c.reason}`
        : `${c.byName} · ${c.reason} — ${t("time.correction.before", {
            from: timeLabel(c.prevStartedAt),
            to: timeLabel(c.prevEndedAt),
            pause: c.prevBreakMinutes ?? 0,
          })}${c.prevOrderNumber ? ` · ${c.prevOrderNumber}` : ""}${c.prevActivity ? ` · ${c.prevActivity}` : ""}`,
    time: date(c.at, { dateStyle: "medium", timeStyle: "short" }),
    tone: c.kind === "void" ? "danger" : "info",
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/time/entries", label: t("time.tabs.entries") }}
        help="office.time"
        title={t("time.entry.title")}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{date(entry.startedAt, { dateStyle: "full" })}</span>
            {entry.voided ? <StatusBadge tone="danger">{t("time.flags.voided")}</StatusBadge> : null}
            {!entry.endedAt && !entry.voided ? <StatusBadge tone="info">{t("time.running")}</StatusBadge> : null}
            {entry.source === "manual" ? <StatusBadge tone="neutral">{t("time.flags.manual")}</StatusBadge> : null}
            {entry.transferred ? <StatusBadge tone="success">{t("time.flags.transferred")}</StatusBadge> : null}
          </span>
        }
      />

      {entry.transferred ? <Alert tone="info" className="mb-5">{t("time.entry.transferredNote")}</Alert> : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 md:col-span-2">
          <Card title={t("time.entry.details")}>
            <DefinitionList
              items={[
                { label: t("time.cols.employee"), value: entry.employeeName ?? (entry.own ? t("time.me") : null) },
                { label: t("time.fields.startTime"), value: <span className="tabular">{timeLabel(entry.startedAt)}</span> },
                { label: t("time.fields.endTime"), value: <span className="tabular">{timeLabel(entry.endedAt)}</span> },
                { label: t("time.fields.break"), value: entry.breakMinutes > 0 ? t("time.minutes", { count: entry.breakMinutes }) : null },
                {
                  label: t("time.cols.duration"),
                  value: (
                    <span className="tabular">
                      {formatDuration(minutes)} · {t("time.aw", { aw: number(minutes / Math.max(1, workshop.workUnitMinutes), { maximumFractionDigits: 1 }) })}
                    </span>
                  ),
                },
                {
                  label: t("time.fields.order"),
                  value: entry.orderId && entry.orderNumber ? (session.can("orders.view") ? <TextLink href={`/orders/${entry.orderId}`}>{[entry.orderNumber, entry.plate].filter(Boolean).join(" · ")}</TextLink> : entry.orderNumber) : null,
                },
                { label: t("time.fields.activity"), value: entry.activity },
                { label: t("time.fields.note"), value: entry.note },
              ]}
            />
          </Card>

          {mayChange ? (
            <CorrectForm
              id={entry.id}
              version={entry.version}
              running={!entry.endedAt}
              orders={orderOptions}
              cancelHref="/time/entries"
              initial={{
                startDate: toDateInput(entry.startedAt),
                startTime: toTimeInput(entry.startedAt),
                endDate: entry.endedAt ? toDateInput(entry.endedAt) : "",
                endTime: entry.endedAt ? toTimeInput(entry.endedAt) : "",
                breakMinutes: String(entry.breakMinutes),
                orderId: entry.orderId ?? "",
                activity: entry.activity ?? "",
                note: entry.note ?? "",
              }}
            />
          ) : null}

          {mayChange ? (
            <Card title={t("time.void.title")}>
              <p className="mb-3 text-sm text-ink-muted">{t("time.void.intro")}</p>
              <VoidForm id={entry.id} version={entry.version} />
            </Card>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title={t("time.correction.title")}>
            {history.length === 0 ? <p className="text-sm text-ink-muted">{t("time.correction.empty")}</p> : <Timeline items={history} label={t("time.correction.title")} />}
          </Card>
        </div>
      </div>
    </>
  );
}
