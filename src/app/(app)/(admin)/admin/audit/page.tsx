import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput, Select } from "@/components/ui/form";
import { getI18n } from "@/i18n/server";
import { AUDIT_GROUPS } from "@/lib/audit-actions";
import { clampPage, listLinks, pageWindow, parseListParams } from "@/lib/list-params";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains, searchWhere } from "@/server/search";
import type { Prisma } from "@/generated/prisma/client";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("audit.title") };
}

const PAGE_SIZE = 50;
const DEFAULT = { sort: "time", dir: "desc" } as const;

type SearchParams = { q?: string; group?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("audit.view");
  const [{ t, tp, td, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const group = AUDIT_GROUPS.includes(sp.group ?? "") ? sp.group! : "";
  const list = parseListParams(sp, { sorts: [], ...DEFAULT, pageSize: PAGE_SIZE });

  const text = searchWhere<Prisma.AuditLogWhereInput>(q, session.can, [{ where: (term) => ({ actorName: contains(term) }) }, { where: (term) => ({ target: contains(term) }) }]);
  const where: Prisma.AuditLogWhereInput = { ...(group ? { action: { startsWith: `${group}.` } } : {}), ...(text ?? {}) };
  const total = await db.auditLog.count({ where });
  const page = clampPage(list.page, total, list.pageSize);
  const entries = await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...pageWindow(page, list.pageSize) });
  const links = listLinks("/admin/audit", { q: q || undefined, group: group || undefined }, list, DEFAULT);

  return (
    <>
      <PageHeader title={t("audit.title")} description={t("audit.description")} help="admin.audit" />

      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_14rem_auto]"
        active={Boolean(q || group)}
        extrasOpen={Boolean(group)}
        resetHref="/admin/audit"
        search={<SearchInput name="q" defaultValue={q} placeholder={t("audit.searchPlaceholder")} aria-label={t("audit.searchPlaceholder")} />}
      >
        <Select name="group" defaultValue={group} aria-label={t("audit.cols.action")}>
          <option value="">{t("audit.allActions")}</option>
          {AUDIT_GROUPS.map((g) => (
            <option key={g} value={g}>
              {td(`audit.groups.${g}`, g)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        caption={t("audit.title")}
        rows={entries}
        rowKey={(e) => e.id}
        minWidth="44rem"
        summary={tp("audit.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("audit.empty")} />}
        columns={[
          { id: "time", header: t("audit.cols.time"), priority: "primary", cell: (e) => <span className="tabular whitespace-nowrap">{date(e.createdAt, { dateStyle: "short", timeStyle: "medium" })}</span> },
          { id: "actor", header: t("audit.cols.actor"), cell: (e) => e.actorName },
          { id: "action", header: t("audit.cols.action"), cell: (e) => td(`audit.actions.${e.action}`, e.action) },
          { id: "target", header: t("audit.cols.target"), cell: (e) => <span className="text-ink-muted">{e.target ?? "–"}</span> },
        ]}
      />
    </>
  );
}
