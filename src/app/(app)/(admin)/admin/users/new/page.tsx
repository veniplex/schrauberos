import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { UserForm } from "@/modules/admin/users/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.new") };
}

export default async function NewUserPage() {
  const session = await requirePermission("users.manage");
  const [{ t }, roles] = await Promise.all([getI18n(), db.role.findMany({ orderBy: [{ isAdmin: "desc" }, { name: "asc" }] })]);
  return (
    <>
      <PageHeader title={t("users.new")} />
      <UserForm
        initial={{ username: "", name: "", email: "", active: true, mustChangePassword: true, roleIds: [], authSource: "local" }}
        roles={roles}
        canAssignAdmin={session.user.isAdmin}
        isSelf={false}
      />
    </>
  );
}
