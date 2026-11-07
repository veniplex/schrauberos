import type { Metadata } from "next";
import { ListChecks, Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchInput } from "@/components/ui/form";
import { EmptyState, Plate, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedLinks } from "@/components/ui/segmented";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, pageWindow, parseListParams } from "@/lib/list-params";
import { CHECKLIST_STATUSES, type ChecklistStatus } from "@/modules/workshop/checklists/constants";
import { listChecklists, statusCounts } from "@/modules/workshop/checklists/queries";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.checklists") };
}

const DEFAULT = { sort: "created", dir: "desc" } as const;
const TONE: Record<ChecklistStatus, "info" | "success" | "neutral"> = { open: "info", completed: "success", discarded: "neutral" };

/** Checklisten: Reiter Offen / Abgeschlossen / Verworfen / Alle mit Anzahl, Suche nach Vorlage, Kennzeichen und Auftragsnummer. Sichtbar ist, was die Person nach den Rechten für Fahrzeug bzw. Auftrag sehen darf. */
export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; sort?: string; dir?: string }> }) {
  const session = await requirePermission("checklists.view");
  const [{ t, tp, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const status: ChecklistStatus | "all" = (CHECKLIST_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as ChecklistStatus) : sp.status === "all" ? "all" : "open";
  const list = parseListParams(sp, { sorts: ["created"] as const, ...DEFAULT });
  const counts = await statusCounts(session);
  const first = await listChecklists(session, { q, status }, { skip: 0, take: 1 });
  const page = clampPage(list.page, first.total, list.pageSize);
  const { rows, total } = await listChecklists(session, { q, status }, pageWindow(page, list.pageSize));
  const links = listLinks("/checklists", { q: q || undefined, status: status === "open" ? undefined : status }, list, DEFAULT);
  const segment = (value: ChecklistStatus | "all", label: string, count: number) => ({ href: value === "open" ? "/checklists" : `/checklists?status=${value}`, active: status === value, label: `${label} (${count})` });

  return (
    <>
      <PageHeader
        title={t("checklists.title")}
        description={t("checklists.description")}
        help="workshop.checklists"
        actions={
          <>
            {session.can("checklists.manage") ? (
              <LinkButton href="/checklists/templates">
                <ListChecks className="size-4" aria-hidden /> {t("checklists.manageTemplates")}
              </LinkButton>
            ) : null}
            {session.can("checklists.fill") ? (
              <LinkButton href="/checklists/new" variant="primary">
                <Plus className="size-4" aria-hidden /> {t("checklists.quick.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <SegmentedLinks
        label={t("checklists.title")}
        className="mb-4"
        options={[
          segment("open", t("checklists.tabs.open"), counts.open),
          segment("completed", t("checklists.tabs.completed"), counts.completed),
          segment("discarded", t("checklists.tabs.discarded"), counts.discarded),
          segment("all", t("checklists.tabs.all"), counts.open + counts.completed + counts.discarded),
        ]}
      />
      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_auto]"
        keep={{ ...(status !== "open" ? { status } : {}) }}
        active={Boolean(q)}
        resetHref={status === "open" ? "/checklists" : `/checklists?status=${status}`}
        search={<SearchInput name="q" defaultValue={q} placeholder={t("checklists.searchPlaceholder")} aria-label={t("common.search")} />}
      />
      <DataTable
        caption={t("checklists.title")}
        rows={rows}
        rowKey={(c) => c.id}
        rowHref={(c) => `/checklists/${c.id}`}
        minWidth="44rem"
        summary={tp("checklists.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("checklists.empty")} hint={q ? t("common.noResults") : t("checklists.emptyHint")} />}
        columns={[
          { id: "name", header: t("checklists.cols.checklist"), priority: "primary", cell: (c) => <span className="font-medium">{c.templateName}</span>, sub: (c) => `v${c.templateVersion}` },
          { id: "vehicle", header: t("checklists.cols.vehicle"), cell: (c) => <Plate>{c.plate}</Plate>, sub: (c) => c.vehicleName || null },
          { id: "order", header: t("checklists.cols.order"), cell: (c) => (c.orderNumber ? <span className="tabular">{c.orderNumber}</span> : <span className="text-ink-muted">–</span>) },
          { id: "status", header: t("checklists.cols.status"), cell: (c) => <StatusBadge tone={TONE[c.status]}>{t(`checklists.status.${c.status}`)}</StatusBadge> },
          { id: "progress", header: t("checklists.cols.progress"), align: "end", priority: "low", cell: (c) => <span className="tabular">{t("checklists.progressText", { done: c.progress.done, total: c.progress.total })}</span> },
          { id: "date", header: t("checklists.cols.date"), priority: "low", cell: (c) => date(c.createdAt, { dateStyle: "medium" }), sub: (c) => c.createdByName },
        ]}
      />
    </>
  );
}
