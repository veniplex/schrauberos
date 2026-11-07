import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { RoleForm } from "@/modules/admin/roles/forms";
import { permissionSections } from "@/modules/admin/roles/sections";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import { db } from "@/server/db";
import { lockedPermissions } from "@/lib/rbac";
import { loadActor } from "@/server/rbac/hierarchy";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("roles.new") };
}

/** `?from=<id>` dupliziert eine Rolle: Name und Rechte werden vorbelegt (Rechte, die man selbst nicht vergeben darf, bleiben leer). */
export default async function NewRolePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const session = await requirePermission("roles.manage");
  const [{ t }, sections, { from }, actor] = await Promise.all([getI18n(), permissionSections(), searchParams, loadActor(db, session.user.id)]);
  const source = from ? await db.role.findUnique({ where: { id: from }, include: { permissions: true } }) : null;
  const locked = lockedPermissions(actor, ALL_PERMISSIONS);
  const copied = source ? (source.isAdmin ? [...ALL_PERMISSIONS] : source.permissions.map((p) => p.permission)).filter((p) => !locked.includes(p)) : [];
  return (
    <>
      <PageHeader back={{ href: "/admin/roles", label: t("nav.roles") }} help="admin.roles" title={t("roles.new")} />
      <RoleForm
        sections={sections}
        lockedPermissions={locked}
        initial={{ name: source ? t("roles.copyOf", { name: source.name }).slice(0, 60) : "", description: source?.description ?? "", isAdmin: false, permissions: copied }}
      />
    </>
  );
}
