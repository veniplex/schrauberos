import type { Metadata } from "next";
import { ClipboardCheck, PackagePlus, Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchInput, Select } from "@/components/ui/form";
import { Badge, EmptyState, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedLinks } from "@/components/ui/segmented";
import { INTL_LOCALE } from "@/i18n/config";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, pageWindow, parseListParams, sortFields } from "@/lib/list-params";
import { formatCents } from "@/lib/money";
import { stockState } from "@/modules/workshop/parts/domain";
import { listArticles, stockCounts } from "@/modules/workshop/parts/queries";
import { STOCK_TONE } from "@/modules/workshop/parts/status-tone";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.parts") };
}

const SORTS = ["number", "name", "stock"] as const;
const DEFAULT = { sort: "number", dir: "asc" } as const;

export default async function PartsPage({ searchParams }: { searchParams: Promise<{ q?: string; stock?: string; archived?: string; sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("parts.view");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, locale } = i18n;
  const q = (sp.q ?? "").trim();
  const stock = sp.stock === "low" || sp.stock === "negative" ? sp.stock : undefined;
  const archived = sp.archived === "1" ? "archived" : sp.archived === "all" ? "all" : "active";
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });
  const orderBy = list.sort === "name" ? [{ name: list.dir }] : list.sort === "stock" ? [{ stockMilli: list.dir }, { number: "asc" as const }] : [{ number: list.dir }];

  const counts = await stockCounts();
  const first = await listArticles(session, { q, stock, archived }, { skip: 0, take: 1, orderBy });
  const page = clampPage(list.page, first.total, list.pageSize);
  const { rows, total } = await listArticles(session, { q, stock, archived }, { ...pageWindow(page, list.pageSize), orderBy });
  const prices = session.can("parts.prices");
  const links = listLinks("/parts", { q: q || undefined, stock, archived: sp.archived }, list, DEFAULT);
  const money = (cents: number | null | undefined) => (cents == null ? "–" : formatCents(cents, INTL_LOCALE[locale]));
  const qty = (milli: number) => i18n.number(milli / 1000, { maximumFractionDigits: 3 });

  return (
    <>
      <PageHeader
        title={t("parts.title")}
        description={t("parts.description")}
        help="workshop.parts"
        actions={
          <>
            {session.can("parts.stock") ? (
              <>
                <LinkButton href="/parts/receipt" variant="secondary">
                  <PackagePlus className="size-4" aria-hidden /> {t("parts.actions.receipt")}
                </LinkButton>
                <LinkButton href="/parts/count" variant="secondary">
                  <ClipboardCheck className="size-4" aria-hidden /> {t("parts.actions.count")}
                </LinkButton>
              </>
            ) : null}
            {session.can("parts.edit") ? (
              <LinkButton href="/parts/new" variant="primary">
                <Plus className="size-4" aria-hidden /> {t("parts.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />

      <SegmentedLinks
        label={t("parts.title")}
        className="mb-4"
        options={[
          { href: "/parts", active: !stock, label: `${t("parts.filters.all")} (${counts.all})` },
          { href: "/parts?stock=low", active: stock === "low", label: `${t("parts.filters.low")} (${counts.low})` },
          { href: "/parts?stock=negative", active: stock === "negative", label: `${t("parts.filters.negative")} (${counts.negative})` },
        ]}
      />

      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
        keep={{ ...sortFields(list, DEFAULT), ...(stock ? { stock } : {}) }}
        active={Boolean(q) || archived !== "active"}
        extrasOpen={archived !== "active"}
        resetHref={listLinks("/parts", { stock }, list, DEFAULT).pageHref(1)}
        search={<SearchInput name="q" defaultValue={q} placeholder={t("parts.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        <Select name="archived" defaultValue={archived === "archived" ? "1" : archived === "all" ? "all" : ""} aria-label={t("archive.filter.label")}>
          <option value="">{t("archive.filter.active")}</option>
          <option value="1">{t("archive.filter.archived")}</option>
          <option value="all">{t("archive.filter.all")}</option>
        </Select>
      </FilterBar>

      <DataTable
        caption={t("parts.title")}
        rows={rows}
        rowKey={(a) => a.id}
        rowHref={(a) => `/parts/${a.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="48rem"
        summary={tp("parts.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={
          <EmptyState
            title={t("parts.empty")}
            hint={q ? t("common.noResults") : t("parts.emptyHint")}
            action={
              session.can("parts.edit") && !q ? (
                <LinkButton href="/parts/new" variant="primary">
                  {t("parts.new")}
                </LinkButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            id: "number",
            header: t("parts.cols.number"),
            priority: "primary",
            sort: "number",
            cell: (a) => (
              <span className="flex flex-wrap items-center gap-2">
                <span className="tabular font-medium">{a.number}</span>
                {a.archivedAt ? <Badge>{t("archive.badge")}</Badge> : null}
              </span>
            ),
            sub: (a) => a.name,
          },
          { id: "stock", header: t("parts.cols.stock"), align: "end", sort: "stock", cell: (a) => <span className="tabular">{`${qty(a.stockMilli)} ${a.unit}`}</span> },
          { id: "state", header: t("parts.cols.state"), cell: (a) => { const state = stockState(a.stockMilli, a.minStockMilli); return <StatusBadge tone={STOCK_TONE[state]}>{t(`parts.stockState.${state}`)}</StatusBadge>; } },
          { id: "supplier", header: t("parts.cols.supplier"), priority: "low", cell: (a) => a.supplier ?? <span className="text-ink-muted">–</span> },
          ...(prices ? [{ id: "sale", header: t("parts.cols.sale"), align: "end" as const, priority: "low" as const, cell: (a: (typeof rows)[number]) => <span className="tabular">{money(a.saleCents)}</span> }] : []),
        ]}
      />
    </>
  );
}
