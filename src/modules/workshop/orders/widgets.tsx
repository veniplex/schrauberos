import Link from "next/link";
import { Card, EmptyState, Plate, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import type { WidgetDef } from "@/modules/types";
import { dashboardOrders } from "./queries";
import { ORDER_STATUS_TONE } from "./status-tone";

/** Offene Aufträge nach Status und – zuerst – die abholbereiten (die Kundschaft wartet). */
export async function OpenOrdersWidget() {
  const [{ t, tp, date }, { counts, ready }] = await Promise.all([getI18n(), dashboardOrders()]);
  return (
    <Card
      headingLevel={3}
      title={t("orders.widgets.openTitle")}
      actions={
        <TextLink href="/orders" className="text-sm">
          {t("common.showAll")}
        </TextLink>
      }
      padded={false}
    >
      {counts.open === 0 ? (
        <EmptyState title={t("orders.widgets.empty")} />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 px-5 pt-3 text-sm">
            <span className="text-ink-muted">{tp("orders.widgets.openCount", counts.open)}</span>
            <StatusBadge tone={ORDER_STATUS_TONE.accepted}>{t("orders.widgets.accepted", { count: counts.accepted })}</StatusBadge>
            <StatusBadge tone={ORDER_STATUS_TONE.in_progress}>{t("orders.widgets.inProgress", { count: counts.in_progress })}</StatusBadge>
            <StatusBadge tone={ORDER_STATUS_TONE.ready}>{t("orders.widgets.ready", { count: counts.ready })}</StatusBadge>
          </p>
          {ready.length > 0 ? (
            <>
              <h4 className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("orders.widgets.readyTitle")}</h4>
              <ul className="divide-y divide-line">
                {ready.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex min-h-(--tap-row) items-center justify-between gap-3 px-5 py-3 hover:bg-surface-hover">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Plate>{o.vehicle.plate}</Plate>
                          <span className="truncate text-sm">{o.customer ? customerDisplayName(o.customer) : "–"}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {o.number} · {t("orders.widgets.since", { date: date(o.acceptedAt, { dateStyle: "medium" }) })}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [
  { id: "orders-open", titleKey: "orders.widgets.openTitle", priority: 12, feature: "workshop.orders", permission: "orders.view", span: 1, order: 15, Component: OpenOrdersWidget },
];
