import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Alert, Badge, CardLink, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import { hasAdminOnlyRights, isDenial } from "@/lib/rbac";
import { toRights } from "@/server/rbac/hierarchy";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.roles") };
}

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requirePermission("roles.manage");
  const [{ t, tp }, sp] = await Promise.all([getI18n(), searchParams]);
  const roles = await db.role.findMany({
    orderBy: [{ isAdmin: "desc" }, { name: "asc" }],
    include: { permissions: true, _count: { select: { users: true, permissions: true } } },
  });

  return (
    <>
      <PageHeader
        title={t("roles.title")}
        description={t("roles.description")}
        actions={
          <LinkButton href="/admin/roles/new" variant="primary">
            <Plus className="size-4" aria-hidden /> {t("roles.new")}
          </LinkButton>
        }
      />
      {sp.saved ? <div className="mb-4"><Alert tone="success">{t("common.saved")}</Alert></div> : null}
      {isDenial(sp.error) ? <div className="mb-4"><Alert tone="danger">{t(`rbac.denied.${sp.error}`)}</Alert></div> : null}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {roles.map((r) => (
          <li key={r.id}>
            <CardLink href={`/admin/roles/${r.id}`} className="h-full">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{r.name}</h2>
                {r.isAdmin ? <Badge tone="accent">{t("roles.adminBadge")}</Badge> : null}
                {hasAdminOnlyRights([toRights(r)]) ? (
                  <span title={t("roles.adminRightsHint")}>
                    <Badge tone="warning">{t("roles.adminRightsBadge")}</Badge>
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
