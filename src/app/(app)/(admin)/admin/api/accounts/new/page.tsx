import type { Metadata } from "next";
import { Alert } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { checkGrantRole } from "@/lib/rbac";
import { isAdminOnly } from "@/modules/catalog";
import { AccountForm } from "@/modules/admin/api/account-form";
import { listServiceAccounts, MAX_SERVICE_ACCOUNTS } from "@/server/api/service-accounts";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { loadActor, loadRoles } from "@/server/rbac/hierarchy";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("api.accounts.new") };
}

/** Neues Dienstkonto: Name und Rollen (nur Rollen ohne Verwaltungsrechte und ohne Administrator-Flag, die man selbst vollständig besitzt), erneute Passwortabfrage. */
export default async function NewServiceAccountPage() {
  const session = await requirePermission("api.manage");
  const { t } = await getI18n();
  const [accounts, actor, allRoles] = await Promise.all([listServiceAccounts(), loadActor(db, session.user.id), db.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const rights = await loadRoles(
    db,
    allRoles.map((r) => r.id),
  );
  const roles = allRoles.filter((role) => {
    const r = rights.find((x) => x.id === role.id);
    return r !== undefined && !r.isAdmin && !r.permissions.some(isAdminOnly) && checkGrantRole(actor, r) === null;
  });
  return (
    <>
      <PageHeader back={{ href: "/admin/api/accounts", label: t("api.accounts.title") }} title={t("api.accounts.new")} help="admin.api" />
      {accounts.length >= MAX_SERVICE_ACCOUNTS ? <Alert tone="warning">{t("api.accounts.errors.tooMany", { max: MAX_SERVICE_ACCOUNTS })}</Alert> : <AccountForm roles={roles} />}
    </>
  );
}
