import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchInput } from "@/components/ui/form";
import { EmptyState, Plate, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedLinks } from "@/components/ui/segmented";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { clampPage, listLinks, pageWindow, parseListParams, sortFields } from "@/lib/list-params";
import { formatCents } from "@/lib/money";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { ORDER_STATUSES, type OrderStatus } from "@/modules/workshop/orders/constants";
import { listOrders, orderCounts, parseOrderStatusFilter } from "@/modules/workshop/orders/queries";
import { ORDER_STATUS_TONE } from "@/modules/workshop/orders/status-tone";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.orders") };
}

const SORTS = ["accepted", "number", "plate"] as const;
const DEFAULT = { sort: "accepted", dir: "desc" } as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; vehicle?: string; sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("orders.view");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, td, date, locale } = i18n;
  const q = (sp.q ?? "").trim();
  const status = parseOrderStatusFilter(sp.status);
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });
  const orderBy =
    list.sort === "number" ? [{ number: list.dir }] : list.sort === "plate" ? [{ vehicle: { plateNorm: list.dir } }, { acceptedAt: "desc" as const }] : [{ acceptedAt: list.dir }];

  const counts = await orderCounts();
  // erst die Gesamtzahl (für die Seitenwahl), dann die Seite
  const first = await listOrders(session, { q, status, vehicleId: sp.vehicle }, { skip: 0, take: 1, orderBy });
  const page = clampPage(list.page, first.total, list.pageSize);
  const { rows, total } = await listOrders(session, { q, status, vehicleId: sp.vehicle }, { ...pageWindow(page, list.pageSize), orderBy });
  const prices = session.can("orders.prices");
  const links = listLinks("/orders", { q: q || undefined, status: status === "open" ? undefined : status, vehicle: sp.vehicle }, list, DEFAULT);
  const money = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const canCreate = session.can("orders.create");

  const segment = (value: string, label: string, count: number) => ({ href: value === "open" ? "/orders" : `/orders?status=${value}`, active: status === value, label: `${label} (${count})` });

  return (
    <>
      <PageHeader
        title={t("orders.title")}
        description={t("orders.description")}
        help="workshop.orders"
        actions={
          canCreate ? (
            <LinkButton href="/orders/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("orders.new")}
            </LinkButton>
          ) : null
        }
      />

      <SegmentedLinks
        label={t("orders.title")}
        className="mb-4"
        options={[
          segment("open", t("orders.filters.open"), counts.open),
          segment("ready", td("orders.status.ready"), counts.ready),
          segment("picked_up", td("orders.status.picked_up"), counts.picked_up),
          segment("cancelled", td("orders.status.cancelled"), counts.cancelled),
          segment("all", t("orders.filters.all"), ORDER_STATUSES.reduce((sum, s) => sum + counts[s], 0)),
        ]}
      />

      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_auto]"
        keep={{ ...sortFields(list, DEFAULT), ...(status !== "open" ? { status } : {}), ...(sp.vehicle ? { vehicle: sp.vehicle } : {}) }}
        active={Boolean(q)}
        resetHref={listLinks("/orders", { status: status === "open" ? undefined : status }, list, DEFAULT).pageHref(1)}
        search={<SearchInput name="q" defaultValue={q} placeholder={t("orders.searchPlaceholder")} aria-label={t("common.search")} />}
      />

      <DataTable
        caption={t("orders.title")}
        rows={rows}
        rowKey={(o) => o.id}
        rowHref={(o) => `/orders/${o.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="48rem"
        summary={tp("orders.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={
          <EmptyState
            title={t("orders.empty")}
            hint={q ? t("common.noResults") : t("orders.emptyHint")}
            action={
              canCreate && !q ? (
                <LinkButton href="/orders/new" variant="primary">
                  {t("orders.new")}
                </LinkButton>
              ) : undefined
            }
          />
        }
        columns={[
          { id: "number", header: t("orders.cols.number"), priority: "primary", sort: "number", cell: (o) => <span className="tabular font-medium">{o.number}</span>, sub: (o) => date(o.acceptedAt, { dateStyle: "medium" }) },
          {
            id: "vehicle",
            header: t("orders.cols.vehicle"),
            sort: "plate",
            cell: (o) => <Plate>{o.vehicle.plate}</Plate>,
            sub: (o) => [o.vehicle.make, o.vehicle.model].filter(Boolean).join(" ") || null,
          },
          { id: "customer", header: t("orders.cols.customer"), cell: (o) => (o.customer ? customerDisplayName(o.customer) : <span className="text-ink-muted">–</span>) },
          { id: "status", header: t("orders.cols.status"), cell: (o) => <StatusBadge tone={ORDER_STATUS_TONE[o.status as OrderStatus] ?? "neutral"}>{td(`orders.status.${o.status}`, o.status)}</StatusBadge> },
          ...(prices ? [{ id: "total", header: t("orders.cols.total"), align: "end" as const, priority: "low" as const, cell: (o: (typeof rows)[number]) => (o.totals ? <span className="tabular">{money(o.totals.grossCents)}</span> : "–") }] : []),
        ]}
      />
    </>
  );
}
