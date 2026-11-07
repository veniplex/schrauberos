import type { Metadata } from "next";
import { Alert, Card } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LocaleSwitch, ThemeSwitch } from "@/components/shell/switches";
import { getI18n, getLocale, getTheme } from "@/i18n/server";
import { listSessions, requireSession } from "@/server/auth/session";
import { PasswordForm, ProfileForm } from "@/platform/account/forms";
import { RecoveryCard } from "@/platform/account/recovery-card";
import { TwoFactorCard } from "@/platform/account/two-factor-card";
import { DevicesCard, SessionsCard } from "@/platform/account/sessions-card";
import { listDevices } from "@/server/auth/devices";
import { authPolicy } from "@/server/auth/policy";
import { twoFactorStatus } from "@/server/auth/second-factor";
import { db } from "@/server/db";
import { FieldHint, FieldLabel } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.account") };
}

export default async function AccountPage() {
  const session = await requireSession({ allowPasswordChange: true });
  const [{ t, date }, locale, theme] = await Promise.all([getI18n(), getLocale(), getTheme()]);
  const showRecovery = session.user.isAdmin && session.user.authSource === "local" && !session.user.mustChangePassword;
  const forced = session.user.mustChangePassword;
  const [recovery, twoFactor, sessions, devices, policy] = await Promise.all([
    showRecovery ? db.recoveryCode.findUnique({ where: { userId: session.user.id } }) : null,
    twoFactorStatus(session.user.id),
    forced ? [] : listSessions(session.user.id),
    forced ? [] : listDevices(session.user.id),
    authPolicy(),
  ]);
  const requireSecond = policy.requireTwoFactorForAdmins && session.user.isAdmin;

  return (
    <>
      {/* Beim Drucken (Wiederherstellungs-Code) erscheint nur die Karte des Codes: alles andere ist print:hidden */}
      <div className="print:hidden">
        <PageHeader title={t("account.title")} description={`${session.user.username} · ${session.user.roleNames.join(", ") || "–"}`} />
        {forced ? (
          <div className="mb-5 max-w-2xl">
            <Alert tone="warning">{t("account.mustChange")}</Alert>
          </div>
        ) : session.user.mustSetupTwoFactor ? (
          <div className="mb-5 max-w-2xl">
            <Alert tone="warning">{t("security.twoFactor.requiredNotice")}</Alert>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 max-w-5xl gap-5 lg:grid-cols-2">
        {!forced ? (
          <div className="contents print:hidden">
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
          </div>
        ) : null}
        <div className="contents print:hidden">
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
        {!forced ? (
          <div className="contents">
            <Card title={t("security.twoFactor.title")}>
              <TwoFactorCard
                status={{ enabled: twoFactor.enabled, enabledOn: twoFactor.enabledAt ? date(twoFactor.enabledAt, { dateStyle: "medium" }) : null, codesLeft: twoFactor.backupCodesLeft }}
                required={requireSecond}
                account={{ name: session.user.name, username: session.user.username }}
              />
            </Card>
          </div>
        ) : null}
        {showRecovery ? (
          <Card title={t("recovery.title")}>
            <RecoveryCard
              status={{ createdOn: recovery ? date(recovery.createdAt, { dateStyle: "medium" }) : null, confirmed: !!recovery?.confirmedAt }}
              account={{ name: session.user.name, username: session.user.username }}
            />
          </Card>
        ) : null}
        {!forced ? <SessionsCard sessions={sessions} /> : null}
        {!forced ? <DevicesCard devices={devices} /> : null}
      </div>
    </>
  );
}
