import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { checkGrantRole } from "@/lib/rbac";
import { loadActor, toRights } from "@/server/rbac/hierarchy";
import { UserForm } from "@/modules/admin/users/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.new") };
}

export default async function NewUserPage() {
  const session = await requirePermission("users.manage");
  const [{ t }, roles, actor] = await Promise.all([
    getI18n(),
    db.role.findMany({ orderBy: [{ isAdmin: "desc" }, { name: "asc" }], include: { permissions: true } }),
    loadActor(db, session.user.id),
  ]);
  return (
    <>
      <PageHeader title={t("users.new")} />
      <UserForm
        initial={{ username: "", name: "", email: "", active: true, mustChangePassword: true, roleIds: [], authSource: "local" }}
        roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description, isAdmin: r.isAdmin }))}
        lockedRoleIds={roles.filter((r) => checkGrantRole(actor, toRights(r)) !== null).map((r) => r.id)}
        isSelf={false}
      />
    </>
  );
}
