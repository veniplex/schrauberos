import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, pageWindow, parseListParams } from "@/lib/list-params";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasAdminOnlyRights } from "@/lib/rbac";
import { toRights } from "@/server/rbac/hierarchy";
import { nowDate } from "@/lib/dates";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.users") };
}

const SORTS = ["name", "lastLogin"] as const;
const DEFAULT = { sort: "name", dir: "asc" } as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("users.view");
  const [{ t, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });
  const total = await db.user.count();
  const page = clampPage(list.page, total, list.pageSize);
  const users = await db.user.findMany({
    orderBy: list.sort === "lastLogin" ? [{ lastLoginAt: list.dir }, { name: "asc" }] : { name: list.dir },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
    ...pageWindow(page, list.pageSize),
  });
  const canManage = session.can("users.manage");
  const now = nowDate();
  const links = listLinks("/admin/users", {}, list, DEFAULT);

  return (
    <>
      <PageHeader
        title={t("users.title")}
        description={t("users.description")}
        help="admin.users"
        actions={
          canManage ? (
            <LinkButton href="/admin/users/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("users.new")}
            </LinkButton>
          ) : null
        }
      />

      <DataTable
        caption={t("users.title")}
        rows={users}
        rowKey={(u) => u.id}
        rowHref={canManage ? (u) => `/admin/users/${u.id}` : undefined}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="44rem"
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        columns={[
          { id: "user", header: t("users.cols.user"), priority: "primary", sort: "name", cell: (u) => u.name, sub: (u) => u.username },
          {
            id: "roles",
            header: t("users.cols.roles"),
            cell: (u) => (
              <div className="flex flex-wrap gap-1.5">
                {hasAdminOnlyRights(u.roles.map((r) => toRights(r.role))) ? (
                  <span title={t("users.adminRightsHint")}>
                    <StatusBadge tone="warning">{t("users.adminRightsBadge")}</StatusBadge>
                  </span>
                ) : null}
                {u.roles.length ? u.roles.map((r) => <Badge key={r.roleId} tone={r.role.isAdmin ? "accent" : "neutral"}>{r.role.name}</Badge>) : <span className="text-ink-muted">–</span>}
              </div>
            ),
          },
          { id: "source", header: t("users.cols.source"), priority: "low", cell: (u) => <span className="text-sm text-ink-muted">{u.authSource === "local" ? t("users.sourceLocal") : u.authSource}</span> },
          {
            id: "lastLogin",
            header: t("users.cols.lastLogin"),
            sort: "lastLogin",
            cell: (u) => <span className="text-sm tabular text-ink-muted">{u.lastLoginAt ? date(u.lastLoginAt, { dateStyle: "medium", timeStyle: "short" }) : "–"}</span>,
          },
          {
            id: "status",
            header: t("common.status"),
            cell: (u) => (
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge tone={u.active ? "success" : "neutral"}>{u.active ? t("users.active") : t("users.inactive")}</StatusBadge>
                {u.lockedUntil && u.lockedUntil > now ? <StatusBadge tone="warning">{t("users.throttledBadge")}</StatusBadge> : null}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
