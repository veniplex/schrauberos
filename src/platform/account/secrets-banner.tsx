import { SubmitButton } from "@/components/ui/buttons";
import { Alert } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { readResetNotice } from "@/server/secret-reset";
import { secretKeyIssue } from "@/server/secret-key-issue";
import { LinkButton } from "@/components/ui/buttons";
import { acknowledgeSecretsReset } from "./secrets-actions";

/**
 * Hinweis für **Administratoren** oben auf jeder Seite: Nach einer Wiederherstellung ohne passenden Geheimnisschlüssel wurden nicht lesbare Geheimnisse
 * (Zwei-Faktor-Anmeldung, Update-Token, Off-Site-Zugangsdaten …) zurückgesetzt. Bleibt, bis ein Administrator ihn bestätigt; das Audit-Log hält es zusätzlich fest.
 */
export async function SecretsBanner({ user }: { user: { isAdmin: boolean } }) {
  if (!user.isAdmin) return null;
  const [notice, issue] = await Promise.all([readResetNotice(), secretKeyIssue()]);
  if (!notice && !issue) return null;
  const { t, tp, td, date } = await getI18n();
  return (
    <div className="mb-5 flex flex-col gap-2 no-print">
      {issue ? (
        <Alert tone="danger">
          <p className="font-medium">{t("backup.keyIssue.title")}</p>
          <p>{t(`backup.keyIssue.${issue.kind}`)}</p>
          <span>
            <LinkButton href="/admin/backup/key" size="sm" variant="secondary">
              {t("backup.keyIssue.formTitle")}
            </LinkButton>
          </span>
        </Alert>
      ) : null}
      {notice ? (
      <Alert tone="warning">
        <form action={acknowledgeSecretsReset} className="flex flex-col gap-2">
          <p className="font-medium">{t("backup.reset.title")}</p>
          <p>{t("backup.reset.intro")} ({date(notice.at, { dateStyle: "medium", timeStyle: "short" })})</p>
          <ul className="list-disc pl-5">
            {notice.items.map((item) => (
              <li key={item.id}>{tp("backup.reset.item", item.count, { name: td(`backup.reset.consumers.${item.id}`, item.id) })}</li>
            ))}
          </ul>
          {notice.keyDropped ? <p>{t("backup.reset.keyDropped")}</p> : null}
          {notice.backup ? <p>{t("backup.reset.backup", { name: notice.backup })}</p> : null}
          <span>
            <SubmitButton size="sm" variant="secondary">
              {t("backup.reset.ack")}
            </SubmitButton>
          </span>
        </form>
      </Alert>
      ) : null}
    </div>
  );
}
