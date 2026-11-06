import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Alert, Badge, Card, PageHeader, Table } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasAdminOnlyRights, isDenial } from "@/lib/rbac";
import { toRights } from "@/server/rbac/hierarchy";
import { nowDate } from "@/lib/dates";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.users") };
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const session = await requirePermission("users.view");
  const [{ t, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const users = await db.user.findMany({
    orderBy: { name: "asc" },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  const canManage = session.can("users.manage");
  const now = nowDate();

  return (
    <>
      <PageHeader
        title={t("users.title")}
        description={t("users.description")}
        actions={
          canManage ? (
            <LinkButton href="/admin/users/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("users.new")}
            </LinkButton>
          ) : null
        }
      />
      {sp.saved ? <div className="mb-4"><Alert tone="success">{t("common.saved")}</Alert></div> : null}
      {sp.error === "lastAdmin" ? <div className="mb-4"><Alert tone="danger">{t("users.errors.lastAdmin")}</Alert></div> : null}
      {isDenial(sp.error) ? <div className="mb-4"><Alert tone="danger">{t(`rbac.denied.${sp.error}`)}</Alert></div> : null}

      <Card as="div" padded={false} className="overflow-hidden">
        <Table className="min-w-[44rem]">
            <thead>
              <tr>
                <th>{t("users.cols.user")}</th>
                <th>{t("users.cols.roles")}</th>
                <th>{t("users.cols.source")}</th>
                <th>{t("users.cols.lastLogin")}</th>
                <th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="row-link">
                  <td>
                    {canManage ? (
                      <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                        {u.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{u.name}</span>
                    )}
                    <div className="text-xs text-ink-muted">{u.username}</div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {hasAdminOnlyRights(u.roles.map((r) => toRights(r.role))) ? (
                        <span title={t("users.adminRightsHint")}>
                          <Badge tone="warning">{t("users.adminRightsBadge")}</Badge>
                        </span>
                      ) : null}
                      {u.roles.length ? u.roles.map((r) => <Badge key={r.roleId} tone={r.role.isAdmin ? "accent" : "neutral"}>{r.role.name}</Badge>) : <span className="text-ink-muted">–</span>}
                    </div>
                  </td>
                  <td className="text-sm text-ink-muted">{u.authSource === "local" ? t("users.sourceLocal") : u.authSource}</td>
                  <td className="text-sm tabular text-ink-muted">{u.lastLoginAt ? date(u.lastLoginAt, { dateStyle: "medium", timeStyle: "short" }) : "–"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={u.active ? "success" : "neutral"}>{u.active ? t("users.active") : t("users.inactive")}</Badge>
                      {u.lockedUntil && u.lockedUntil > now ? <Badge tone="warning">{t("users.throttledBadge")}</Badge> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
      </Card>
    </>
  );
}
