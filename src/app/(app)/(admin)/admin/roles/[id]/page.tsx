import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { RoleForm } from "@/modules/admin/roles/forms";
import { permissionSections } from "@/modules/admin/roles/sections";
import { deleteRole } from "@/modules/admin/roles/actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("roles.edit") };
}

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("roles.manage");
  const [{ t, tp }, { id }, sections] = await Promise.all([getI18n(), params, permissionSections()]);
  const role = await db.role.findUnique({
    where: { id },
    include: { permissions: true, _count: { select: { users: true } } },
  });
  if (!role) notFound();

  return (
    <>
      <PageHeader title={role.name} description={tp("roles.userCount", role._count.users)} />
      <div className="flex flex-col gap-4">
        <RoleForm
          key={role.id}
          sections={sections}
          initial={{
            id: role.id,
            name: role.name,
            description: role.description ?? "",
            isAdmin: role.isAdmin,
            permissions: role.permissions.map((p) => p.permission),
          }}
        />
        {!role.isSystem && !role.isAdmin ? (
          <form action={deleteRole} className="max-w-4xl">
            <input type="hidden" name="id" value={role.id} />
            <ConfirmSubmitButton message={t("roles.confirmDelete")}>{t("roles.delete")}</ConfirmSubmitButton>
          </form>
        ) : null}
      </div>
    </>
  );
}
