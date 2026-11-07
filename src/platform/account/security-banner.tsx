import { Alert } from "@/components/ui/layout";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { acknowledgeTwoFactorResetNotice } from "./security-actions";

/**
 * Hinweis oben auf jeder Seite, wenn die Zwei-Faktor-Anmeldung des Kontos **zurückgesetzt** wurde (Backup ohne passenden Schlüssel, Notzugang, Administration): Das Konto ist
 * jetzt nur noch durch das Passwort geschützt, bis die Person den zweiten Faktor neu eingerichtet hat. Der Hinweis bleibt, bis er bestätigt wird.
 */
export async function SecurityBanner({ userId }: { userId: string }) {
  const row = await db.twoFactor.findUnique({ where: { userId }, select: { resetReason: true } });
  const reason = row?.resetReason;
  if (reason !== "key" && reason !== "recovery" && reason !== "admin") return null;
  const { t } = await getI18n();
  return (
    <div className="mb-5 flex flex-col gap-2 no-print">
      <Alert tone="warning">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{t(`security.twoFactor.reset.${reason}`)}</span>
          <span className="flex flex-wrap gap-2">
            <LinkButton size="sm" href="/account">
              {t("nav.account")}
            </LinkButton>
            <form action={acknowledgeTwoFactorResetNotice}>
              <SubmitButton size="sm" variant="secondary">
                {t("security.twoFactor.reset.ack")}
              </SubmitButton>
            </form>
          </span>
        </div>
      </Alert>
    </div>
  );
}
