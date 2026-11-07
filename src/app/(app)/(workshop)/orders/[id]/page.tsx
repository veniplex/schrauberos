import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Alert, Card, DefinitionList, EmptyState, Plate, StatusBadge, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Stepper, Timeline, type TimelineItem } from "@/components/ui/timeline";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { versionOf } from "@/lib/concurrency";
import { formatCents } from "@/lib/money";
import { PageSections } from "@/modules/page-sections";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { closeOrder, removeOrderFinding, reopenOrder, setOrderStatus } from "@/modules/workshop/orders/actions";
import { ApprovalForm } from "@/modules/workshop/orders/approval-form";
import { ORDER_STEPS, type OrderStatus } from "@/modules/workshop/orders/constants";
import { FindingForm } from "@/modules/workshop/orders/finding-form";
import { OrderItemsForm } from "@/modules/workshop/orders/items-form";
import { getOrderDetail } from "@/modules/workshop/orders/queries";
import { ORDER_STATUS_TONE } from "@/modules/workshop/orders/status-tone";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  if (!(await sessionIfAllowed("orders.view"))) return {};
  const order = await db.order.findUnique({ where: { id }, select: { number: true, vehicle: { select: { plate: true } } } });
  return { title: order ? `${order.number} · ${order.vehicle.plate}` : t("orders.title") };
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, td, date, locale } = i18n;
  const order = await getOrderDetail(session, id);
  if (!order) notFound();
  const workshop = await getWorkshop();

  const money = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const version = versionOf(order);
  const status = order.status as OrderStatus;
  const canEdit = session.can("orders.edit") && order.open;
  const prices = session.can("orders.prices");
  const canClose = session.can("orders.close");
  const customerName = order.customer ? customerDisplayName(order.customer) : null;
  const editableItems = canEdit && prices;

  const statusForm = (target: "accepted" | "in_progress" | "ready" | "cancelled", label: string, options: { primary?: boolean; confirm?: string } = {}) => (
    <form action={setOrderStatus} key={target}>
      <input type="hidden" name="id" value={order.id} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="status" value={target} />
      {options.confirm ? (
        <ConfirmSubmitButton message={options.confirm} variant="secondary" size="md">
          {label}
        </ConfirmSubmitButton>
      ) : (
        <SubmitButton variant={options.primary ? "primary" : "secondary"}>{label}</SubmitButton>
      )}
    </form>
  );

  const timeline: TimelineItem[] = order.events.map((event) => ({
    id: event.id,
    title:
      event.kind === "created"
        ? t("orders.timeline.created")
        : event.kind === "reopened"
          ? t("orders.timeline.reopened")
          : event.kind === "approval"
            ? t("orders.timeline.approval")
            : t("orders.timeline.status", { status: td(`orders.status.${event.status}`, event.status ?? "") }),
    description: event.kind === "approval" && event.note ? `${event.note} · ${event.byName}` : event.byName,
    time: date(event.at, { dateStyle: "medium", timeStyle: "short" }),
    tone: event.kind === "reopened" ? "warning" : ((event.status ? ORDER_STATUS_TONE[event.status as OrderStatus] : "neutral") as TimelineItem["tone"]),
  }));

  const steps = ORDER_STEPS.map((step) => ({ id: step, label: td(`orders.status.${step}`, step) }));
  const lineNet = (item: (typeof order.items)[number]) => {
    if (item.unitCents === undefined || item.discountBp === undefined) return null;
    const base = Math.round((item.quantityMilli * item.unitCents) / 1000);
    return base - Math.round((base * item.discountBp) / 10_000);
  };

  return (
    <>
      <PageHeader
        back={{ href: "/orders", label: t("nav.orders") }}
        help="workshop.orders"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Plate>{order.vehicle.plate}</Plate>
            <span className="tabular">{order.number}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={ORDER_STATUS_TONE[status] ?? "neutral"}>{td(`orders.status.${order.status}`, order.status)}</StatusBadge>
            {customerName ? <span>{customerName}</span> : <span className="text-ink-muted">{t("orders.noCustomer")}</span>}
          </span>
        }
        actions={
          canEdit ? (
            <LinkButton href={`/orders/${order.id}/edit`} variant="secondary">
              <Pencil className="size-4" aria-hidden /> {t("common.edit")}
            </LinkButton>
          ) : null
        }
      />

      {order.status !== "cancelled" ? <Stepper className="mb-5" steps={steps} current={order.status} label={t("orders.chain")} /> : <Alert tone="info" className="mb-5">{t("orders.cancelledNote")}</Alert>}

      {order.vehicle.archivedAt ? <Alert tone="warning" className="mb-5">{t("orders.vehicleArchived")}</Alert> : null}

      {session.can("orders.edit") || canClose || session.can("orders.reopen") ? (
        <Card title={t("orders.sections.status")} className="mb-5">
          <div className="flex flex-wrap gap-2">
            {session.can("orders.edit") && status === "accepted" ? statusForm("in_progress", t("orders.actions.start"), { primary: true }) : null}
            {session.can("orders.edit") && (status === "accepted" || status === "in_progress") ? statusForm("ready", t("orders.actions.ready"), { primary: status === "in_progress" && !canClose }) : null}
            {canClose && (status === "in_progress" || status === "ready") ? (
              <form action={closeOrder}>
                <input type="hidden" name="id" value={order.id} />
                <input type="hidden" name="version" value={version} />
                <ConfirmSubmitButton message={t("orders.actions.closeConfirm")} variant="primary" size="md" confirmLabel={t("orders.actions.close")}>
                  {t("orders.actions.close")}
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {session.can("orders.edit") && status === "ready" ? statusForm("in_progress", t("orders.actions.backToWork")) : null}
            {session.can("orders.edit") && status === "in_progress" ? statusForm("accepted", t("orders.actions.backToAccepted")) : null}
            {session.can("orders.edit") && order.open ? statusForm("cancelled", t("orders.actions.cancel"), { confirm: t("orders.actions.cancelConfirm") }) : null}
            {session.can("orders.edit") && status === "cancelled" ? statusForm("accepted", t("orders.actions.resume")) : null}
            {session.can("orders.reopen") && status === "picked_up" ? (
              <form action={reopenOrder}>
                <input type="hidden" name="id" value={order.id} />
                <input type="hidden" name="version" value={version} />
                <ConfirmSubmitButton message={t("orders.actions.reopenConfirm")} variant="secondary" size="md" confirmLabel={t("orders.actions.reopen")}>
                  {t("orders.actions.reopen")}
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </div>
          {status === "picked_up" ? <p className="mt-3 text-sm text-ink-muted">{t("orders.closedNote")}</p> : null}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 md:col-span-2">
          <Card title={t("orders.sections.request")}>
            <p className="whitespace-pre-line text-sm">{order.request || <span className="text-ink-muted">{t("orders.noRequest")}</span>}</p>
          </Card>

          <Card title={t("orders.sections.items")}>
            {editableItems ? (
              <OrderItemsForm
                id={order.id}
                version={version}
                exempt={workshop.smallBusiness}
                tools={<PageSections session={session} host="orders/items" entityId={order.id} />}
                items={order.items.map((item) => ({
                  description: item.description,
                  unit: item.unit,
                  quantityMilli: item.quantityMilli,
                  unitCents: item.unitCents ?? 0,
                  taxBp: item.taxBp ?? 0,
                  discountBp: item.discountBp ?? 0,
                  kind: item.kind,
                  refType: item.refType,
                  refId: item.refId,
                }))}
              />
            ) : order.items.length === 0 ? (
              <EmptyState title={t("orders.items.empty")} hint={canEdit && !prices ? t("orders.items.noPrices") : undefined} />
            ) : (
              <>
                <ul className="flex flex-col divide-y divide-line text-sm">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="break-words font-medium">{item.description}</p>
                        <p className="text-xs text-ink-muted">
                          {td(`orders.kinds.${item.kind}`, item.kind)} · {i18n.number(item.quantityMilli / 1000, { maximumFractionDigits: 3 })} {item.unit}
                          {item.unitCents !== undefined ? ` × ${money(item.unitCents)}${item.discountBp ? ` − ${i18n.number(item.discountBp / 100)} %` : ""} · ${i18n.number((item.taxBp ?? 0) / 100)} %` : ""}
                        </p>
                      </div>
                      {lineNet(item) !== null ? <span className="tabular font-medium">{money(lineNet(item)!)}</span> : null}
                    </li>
                  ))}
                </ul>
                {order.totals ? (
                  <dl aria-label={t("ui.lineItems.summary")} className="ml-auto mt-4 flex w-full max-w-sm flex-col gap-1 border-t border-line pt-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt>{t("ui.lineItems.net")}</dt>
                      <dd className="tabular">{money(order.totals.netCents)}</dd>
                    </div>
                    {order.totals.taxGroups.map((group) => (
                      <div key={group.taxBp} className="flex justify-between gap-4 text-ink-muted">
                        <dt>{workshop.smallBusiness ? t("ui.lineItems.taxExempt") : t("ui.lineItems.tax", { rate: i18n.number(group.taxBp / 100) })}</dt>
                        <dd className="tabular">{money(group.taxCents)}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between gap-4 border-t border-line pt-1.5 text-base font-semibold">
                      <dt>{t("ui.lineItems.gross")}</dt>
                      <dd className="tabular">{money(order.totals.grossCents)}</dd>
                    </div>
                  </dl>
                ) : null}
              </>
            )}
          </Card>

          <PageSections session={session} host="orders/detail" entityId={order.id} />

          <Card title={t("orders.sections.findings")}>
            {order.findings.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("orders.findings.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {order.findings.map((finding) => (
                  <li key={finding.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="whitespace-pre-line break-words">{finding.text}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {finding.authorName} · {date(finding.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </div>
                    {canEdit ? (
                      <form action={removeOrderFinding}>
                        <input type="hidden" name="id" value={order.id} />
                        <input type="hidden" name="findingId" value={finding.id} />
                        <ConfirmSubmitButton message={t("orders.findings.removeConfirm")} variant="ghost" size="sm" label={t("common.remove")} target={finding.text.slice(0, 40)}>
                          {t("common.remove")}
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <div className="mt-4 border-t border-line pt-4">
                <FindingForm id={order.id} />
              </div>
            ) : null}
          </Card>

          <Card title={t("orders.sections.approvals")}>
            <p className="mb-3 text-sm text-ink-muted">{t("orders.approvals.intro")}</p>
            {order.approvals.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("orders.approvals.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {order.approvals.map((approval) => (
                  <li key={approval.id} className="rounded-md border border-line p-3 text-sm">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{approval.approverName}</span>
                      {approval.amountCents !== undefined ? <span className="tabular font-medium">{money(approval.amountCents)}</span> : null}
                    </p>
                    <p className="mt-1 whitespace-pre-line break-words">{approval.reason}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {td(`orders.approvals.methods.${approval.method}`, approval.method)} · {t("orders.approvals.recordedBy", { name: approval.recordedByName })} · {date(approval.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                      {approval.method === "signature" && prices ? (
                        <>
                          {" · "}
                          <TextLink href={`/api/orders/approvals/${approval.id}/signature`} external target="_blank" rel="noopener">
                            {t("orders.approvals.viewSignature")}
                          </TextLink>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canEdit && prices ? (
              <div className="mt-4 border-t border-line pt-4">
                <ApprovalForm id={order.id} />
              </div>
            ) : null}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title={t("orders.sections.vehicle")}>
            <p className="font-medium">
              {session.can("vehicles.view") ? <TextLink href={`/vehicles/${order.vehicle.id}`}>{[order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ") || order.vehicle.plate}</TextLink> : [order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ")}
            </p>
            <DefinitionList
              items={[
                { label: t("orders.fields.mileage"), value: order.mileageKm != null ? `${i18n.number(order.mileageKm)} km` : null },
                { label: t("orders.fields.vehicleMileage"), value: order.vehicle.mileageKm != null ? `${i18n.number(order.vehicle.mileageKm)} km` : null },
              ]}
            />
          </Card>

          <Card title={t("orders.sections.customer")}>
            {order.customer ? (
              <>
                <p className="font-medium">{session.can("customers.view") ? <TextLink href={`/customers/${order.customer.id}`}>{customerName}</TextLink> : customerName}</p>
                {order.phone ? <p className="mt-1 text-sm">{order.phone}</p> : null}
              </>
            ) : (
              <p className="text-sm text-ink-muted">{t("orders.noCustomer")}</p>
            )}
            {order.appointment ? (
              <p className="mt-3 text-sm">
                <span className="text-ink-muted">{t("orders.fields.appointment")}: </span>
                <Link href={`/appointments?show=${order.appointment.id}`} className="underline underline-offset-2">
                  {order.appointment.title} · {date(order.appointment.startsAt, { dateStyle: "medium", timeStyle: "short" })}
                </Link>
              </p>
            ) : null}
          </Card>

          <Card title={t("orders.sections.history")}>
            <Timeline items={timeline} label={t("orders.sections.history")} />
          </Card>
        </div>
      </div>
    </>
  );
}
