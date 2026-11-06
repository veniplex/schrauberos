import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { UserForm } from "@/modules/admin/users/forms";
import { deleteUser } from "@/modules/admin/users/actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.edit") };
}

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("users.manage");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const [user, roles] = await Promise.all([
    db.user.findUnique({ where: { id }, include: { roles: true, employee: true } }),
    db.role.findMany({ orderBy: [{ isAdmin: "desc" }, { name: "asc" }] }),
  ]);
  if (!user) notFound();
  const isSelf = user.id === session.user.id;

  return (
    <>
      <PageHeader
        title={user.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{user.username}</span>
            {user.employee ? (
              session.can("employees.view") ? (
                <Link href={`/employees/${user.employee.id}`} className="text-accent-text hover:underline">
                  {t("users.linkedEmployee", { name: `${user.employee.firstName} ${user.employee.lastName}` })}
                </Link>
              ) : (
                <span>{t("users.linkedEmployee", { name: `${user.employee.firstName} ${user.employee.lastName}` })}</span>
              )
            ) : null}
          </span>
        }
      />
      <div className="flex flex-col gap-4">
        <UserForm
          initial={{
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email ?? "",
            active: user.active,
            mustChangePassword: user.mustChangePassword,
            roleIds: user.roles.map((r) => r.roleId),
            authSource: user.authSource,
          }}
          roles={roles}
          canAssignAdmin={session.user.isAdmin}
          isSelf={isSelf}
        />
        {!isSelf ? (
          <form action={deleteUser} className="max-w-3xl">
            <input type="hidden" name="id" value={user.id} />
            <ConfirmSubmitButton message={t("users.confirmDelete", { name: user.name })}>{t("users.delete")}</ConfirmSubmitButton>
          </form>
        ) : null}
      </div>
    </>
  );
}
