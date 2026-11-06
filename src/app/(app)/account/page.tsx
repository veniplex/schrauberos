import type { Metadata } from "next";
import { Alert, Card, PageHeader } from "@/components/ui/layout";
import { LocaleSwitch, ThemeSwitch } from "@/components/shell/switches";
import { getI18n, getLocale, getTheme } from "@/i18n/server";
import { requireSession } from "@/server/auth/session";
import { PasswordForm, ProfileForm } from "@/platform/account/forms";
import { RecoveryCard } from "@/platform/account/recovery-card";
import { db } from "@/server/db";
import { FieldHint, FieldLabel } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.account") };
}

export default async function AccountPage() {
  const session = await requireSession({ allowPasswordChange: true });
  const [{ t, date }, locale, theme] = await Promise.all([getI18n(), getLocale(), getTheme()]);
  const recovery = session.user.isAdmin && session.user.authSource === "local" && !session.user.mustChangePassword ? await db.recoveryCode.findUnique({ where: { userId: session.user.id } }) : null;
  const showRecovery = session.user.isAdmin && session.user.authSource === "local" && !session.user.mustChangePassword;
  const forced = session.user.mustChangePassword;

  return (
    <>
      <PageHeader title={t("account.title")} description={`${session.user.username} · ${session.user.roleNames.join(", ") || "–"}`} />
      {forced ? (
        <div className="mb-5 max-w-2xl">
          <Alert tone="warning">{t("account.mustChange")}</Alert>
        </div>
      ) : null}
      <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
        {!forced ? (
          <>
            <Card title={t("account.profile")}>
              <ProfileForm initial={{ name: session.user.name, email: session.user.email ?? "" }} />
            </Card>
            <Card title={t("account.appearance")}>
              <div className="flex flex-col gap-4">
                <div>
                  <FieldLabel>{t("preferences.language")}</FieldLabel>
                  <LocaleSwitch current={locale} />
                </div>
                <div>
                  <FieldLabel>{t("preferences.theme")}</FieldLabel>
                  <ThemeSwitch current={theme} />
                  <FieldHint>{t("preferences.themeHint")}</FieldHint>
                </div>
              </div>
            </Card>
          </>
        ) : null}
        {session.user.authSource === "local" ? (
          <Card title={t("account.password")}>
            <PasswordForm />
          </Card>
        ) : (
          <Card title={t("account.password")}>
            <p className="text-sm text-ink-muted">{t("account.errors.externalPassword")}</p>
          </Card>
        )}
        {showRecovery ? (
          <Card title={t("recovery.title")}>
            <RecoveryCard
              status={{ createdOn: recovery ? date(recovery.createdAt, { dateStyle: "medium" }) : null, confirmed: !!recovery?.confirmedAt }}
              account={{ name: session.user.name, username: session.user.username }}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
