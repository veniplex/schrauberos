import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Badge, CardLink, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import { hasAdminOnlyRights } from "@/lib/rbac";
import { toRights } from "@/server/rbac/hierarchy";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.roles") };
}

export default async function RolesPage() {
  await requirePermission("roles.manage");
  const { t, tp } = await getI18n();
  const roles = await db.role.findMany({
    orderBy: [{ isAdmin: "desc" }, { name: "asc" }],
    include: { permissions: true, _count: { select: { users: true, permissions: true } } },
  });

  return (
    <>
      <PageHeader
        title={t("roles.title")}
        description={t("roles.description")}
        help="admin.roles"
        actions={
          <LinkButton href="/admin/roles/new" variant="primary">
            <Plus className="size-4" aria-hidden /> {t("roles.new")}
          </LinkButton>
        }
      />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {roles.map((r) => (
          <li key={r.id}>
            <CardLink href={`/admin/roles/${r.id}`} className="h-full">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{r.name}</h2>
                {r.isAdmin ? <Badge tone="accent">{t("roles.adminBadge")}</Badge> : null}
                {hasAdminOnlyRights([toRights(r)]) ? (
                  <span title={t("roles.adminRightsHint")}>
                    <StatusBadge tone="warning">{t("roles.adminRightsBadge")}</StatusBadge>
                  </span>
                ) : null}
              </div>
              {r.description ? <p className="mt-1 text-sm text-ink-muted">{r.description}</p> : null}
              <p className="mt-4 text-sm text-ink-muted">
                {tp("roles.userCount", r._count.users)} ·{" "}
                {r.isAdmin ? t("roles.allPermissions") : t("roles.permissionCount", { count: r._count.permissions, total: ALL_PERMISSIONS.length })}
              </p>
            </CardLink>
          </li>
        ))}
      </ul>
    </>
  );
}
