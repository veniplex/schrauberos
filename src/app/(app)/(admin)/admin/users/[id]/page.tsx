import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Card, TextLink, DangerZone } from "@/components/ui/layout";
import { Field, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { UserForm } from "@/modules/admin/users/forms";
import { deleteUser, resetTwoFactor, unlockUser } from "@/modules/admin/users/actions";
import { twoFactorStatus } from "@/server/auth/second-factor";
import { nowDate } from "@/lib/dates";
import { versionOf } from "@/lib/concurrency";
import { checkGrantRole, checkManageUser } from "@/lib/rbac";
import { loadActor, toRights } from "@/server/rbac/hierarchy";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.edit") };
}

export default async function EditUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ unlocked?: string; twoFactorReset?: string }> }) {
  const session = await requirePermission("users.manage");
  const [{ t, date }, { id }, sp] = await Promise.all([getI18n(), params, searchParams]);
  const twoFactor = await twoFactorStatus(id);
  const [user, roles, actor] = await Promise.all([
    db.user.findUnique({ where: { id }, include: { roles: { include: { role: { include: { permissions: true } } } }, employee: { select: { id: true, firstName: true, lastName: true } } } }),
    db.role.findMany({ orderBy: [{ isAdmin: "desc" }, { name: "asc" }], include: { permissions: true } }),
    loadActor(db, session.user.id),
  ]);
  if (!user) notFound();
  const isSelf = user.id === session.user.id;
  // Rechte-Hierarchie: nur Konten ändern, deren Rechte man selbst vollständig hat; Rollen, die man nicht vergeben darf, sind gesperrt
  const isService = user.authSource === "service";
  // Ein Dienstkonto (nur für API-Tokens) wird nicht hier, sondern unter „API & Webhooks → Dienstkonten“ verwaltet
  const readOnly = isService || checkManageUser(actor, user.roles.map((r) => toRights(r.role))) !== null;
  const lockedRoleIds = roles.filter((r) => checkGrantRole(actor, toRights(r)) !== null).map((r) => r.id);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/users", label: t("nav.users") }} help="admin.users"
        title={user.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{user.username}</span>
            {user.employee ? (
              session.can("employees.view") ? (
                <TextLink href={`/employees/${user.employee.id}`}>
                  {t("users.linkedEmployee", { name: `${user.employee.firstName} ${user.employee.lastName}` })}
                </TextLink>
              ) : (
                <span>{t("users.linkedEmployee", { name: `${user.employee.firstName} ${user.employee.lastName}` })}</span>
              )
            ) : null}
          </span>
        }
      />
      <div className="flex flex-col gap-4">
        {isService ? <Alert tone="info">{t("users.errors.serviceAccount")}</Alert> : readOnly ? <Alert tone="warning">{t("users.readOnlyNotice")}</Alert> : null}
        {sp.unlocked ? <Alert tone="success">{t("users.unlocked")}</Alert> : null}
        {sp.twoFactorReset ? <Alert tone="success">{t("users.twoFactorResetDone")}</Alert> : null}
        {!readOnly && user.lockedUntil && user.lockedUntil > nowDate() ? (
          <Alert tone="warning">
            <form action={unlockUser} className="flex flex-wrap items-center justify-between gap-3">
              <input type="hidden" name="id" value={user.id} />
              <span>{t("users.unlockHint")}</span>
              <SubmitButton size="sm">{t("users.unlock")}</SubmitButton>
            </form>
          </Alert>
        ) : null}
        {!readOnly ? <UserForm
          initial={{
            id: user.id,
            version: versionOf(user),
            username: user.username,
            name: user.name,
            email: user.email ?? "",
            active: user.active,
            mustChangePassword: user.mustChangePassword,
            roleIds: user.roles.map((r) => r.roleId),
            authSource: user.authSource,
          }}
          roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description, isAdmin: r.isAdmin }))}
          lockedRoleIds={lockedRoleIds}
          isSelf={isSelf}
        /> : null}
        {!isSelf && !readOnly && twoFactor.enabled ? (
          <Card title={t("users.twoFactor.title")} className="max-w-3xl">
            <form action={resetTwoFactor} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={user.id} />
              <p className="text-sm text-ink-muted">{t("users.twoFactor.intro", { date: twoFactor.enabledAt ? date(twoFactor.enabledAt, { dateStyle: "medium" }) : "–" })}</p>
              <Field label={t("users.twoFactor.password")} htmlFor="reset-password" name="password" hint={t("users.twoFactor.passwordHint")} required>
                <Input id="reset-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
              </Field>
              <div>
                <ConfirmSubmitButton message={t("users.twoFactor.confirm", { name: user.name })} variant="danger" size="md">
                  {t("users.twoFactor.reset")}
                </ConfirmSubmitButton>
              </div>
            </form>
          </Card>
        ) : null}
        {!isSelf && !readOnly ? (
          <DangerZone title={t("common.dangerZone")} className="max-w-3xl">
            <form action={deleteUser}>
              <input type="hidden" name="id" value={user.id} />
              <ConfirmSubmitButton message={t("users.confirmDelete", { name: user.name })}>{t("users.delete")}</ConfirmSubmitButton>
            </form>
          </DangerZone>
        ) : null}
      </div>
    </>
  );
}
