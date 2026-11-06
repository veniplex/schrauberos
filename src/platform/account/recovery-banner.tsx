import { Alert } from "@/components/ui/layout";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { recoveryBannerData } from "@/server/auth/recovery";
import { acknowledgeNotice, confirmRecoveryCode } from "./recovery-actions";

/**
 * Hinweise zum Notzugang oben auf jeder Seite: „Notzugang wurde verwendet“ (für das Konto und alle Administratoren, bis sie es
 * gesehen haben) und – für Administratoren – die Erinnerung, den eigenen Wiederherstellungs-Code als gesichert zu bestätigen.
 */
export async function RecoveryBanner({ user }: { user: { id: string; isAdmin: boolean } }) {
  const [{ t, date }, data] = await Promise.all([getI18n(), recoveryBannerData(user)]);
  if (data.notices.length === 0 && !data.unconfirmed) return null;
  return (
    <div className="mb-5 flex flex-col gap-2 no-print">
      {data.notices.map((n) => (
        <Alert key={n.id} tone="danger">
          <form action={acknowledgeNotice} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="id" value={n.id} />
            <span>{n.own ? t("recovery.banner.usedOwn", { date: date(n.at, { dateStyle: "medium", timeStyle: "short" }) }) : t("recovery.banner.used", { date: date(n.at, { dateStyle: "medium", timeStyle: "short" }), name: n.userName })}</span>
            <SubmitButton size="sm" variant="secondary">
              {t("recovery.banner.ack")}
            </SubmitButton>
          </form>
        </Alert>
      ))}
      {data.unconfirmed ? (
        <Alert tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("recovery.banner.unconfirmed")}</span>
            <span className="flex flex-wrap gap-2">
              <form action={confirmRecoveryCode}>
                <SubmitButton size="sm" variant="secondary">
                  {t("recovery.banner.confirm")}
                </SubmitButton>
              </form>
              <LinkButton size="sm" href="/account">
                {t("recovery.banner.toAccount")}
              </LinkButton>
            </span>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
