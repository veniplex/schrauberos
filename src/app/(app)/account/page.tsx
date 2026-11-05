import type { Metadata } from "next";
import { Alert, Card, PageHeader } from "@/components/ui/layout";
import { LocaleSwitch, ThemeSwitch } from "@/components/shell/switches";
import { getI18n, getLocale, getTheme } from "@/i18n/server";
import { requireSession } from "@/server/auth/session";
import { PasswordForm, ProfileForm } from "@/modules/core/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.account") };
}

export default async function AccountPage() {
  const session = await requireSession({ allowPasswordChange: true });
  const [{ t }, locale, theme] = await Promise.all([getI18n(), getLocale(), getTheme()]);
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
                  <p className="field-label">{t("preferences.language")}</p>
                  <LocaleSwitch current={locale} />
                </div>
                <div>
                  <p className="field-label">{t("preferences.theme")}</p>
                  <ThemeSwitch current={theme} />
                  <p className="field-hint">{t("preferences.themeHint")}</p>
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
      </div>
    </>
  );
}
