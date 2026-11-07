import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, DangerZone } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { RoleForm } from "@/modules/admin/roles/forms";
import { permissionSections, rolePreviewData, roleTemplates } from "@/modules/admin/roles/sections";
import { deleteRole } from "@/modules/admin/roles/actions";
import { versionOf } from "@/lib/concurrency";
import { checkRoleChange, checkRoleDelete, lockedPermissions } from "@/lib/rbac";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import { loadActor, toRights } from "@/server/rbac/hierarchy";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("roles.edit") };
}

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("roles.manage");
  const [{ t, tp }, { id }, sections, templates, preview] = await Promise.all([getI18n(), params, permissionSections(), roleTemplates(), rolePreviewData()]);
  const role = await db.role.findUnique({
    where: { id },
    include: { permissions: true, _count: { select: { users: true } } },
  });
  if (!role) notFound();
  // Rechte-Hierarchie: eigene Rolle, Administrator-Rollen und Rollen mit Verwaltungsrechten ändert nur ein Administrator
  const actor = await loadActor(db, session.user.id);
  const current = toRights(role);
  const readOnly = checkRoleChange(actor, current, current.permissions) !== null;
  const canDelete = !role.isSystem && !role.isAdmin && checkRoleDelete(actor, current) === null;

  return (
    <>
      <PageHeader
        back={{ href: "/admin/roles", label: t("nav.roles") }} help="admin.roles"
        title={role.name}
        description={tp("roles.userCount", role._count.users)}
        actions={
          <LinkButton href={`/admin/roles/new?from=${role.id}`} variant="ghost">
            {t("roles.duplicate")}
          </LinkButton>
        }
      />
      <div className="flex flex-col gap-4">
        {readOnly ? <Alert tone="warning">{t("roles.readOnlyNotice")}</Alert> : null}
        {!readOnly ? <RoleForm
          key={role.id}
          sections={sections}
          templates={templates}
          preview={preview}
          lockedPermissions={lockedPermissions(actor, ALL_PERMISSIONS)}
          initial={{
            id: role.id,
            version: versionOf(role),
            name: role.name,
            description: role.description ?? "",
            isAdmin: role.isAdmin,
            permissions: role.permissions.map((p) => p.permission),
          }}
        /> : null}
        {canDelete ? (
          <DangerZone title={t("common.dangerZone")} className="max-w-4xl">
            <form action={deleteRole}>
              <input type="hidden" name="id" value={role.id} />
              <ConfirmSubmitButton message={t("roles.confirmDelete")}>{t("roles.delete")}</ConfirmSubmitButton>
            </form>
          </DangerZone>
        ) : null}
      </div>
    </>
  );
}
