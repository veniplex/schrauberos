import { DataTable } from "@/components/ui/data-table";
import { SubmitButton } from "@/components/ui/buttons";
import { Alert, StatusBadge } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { normalizeMailAddress, splitAddresses, type MailStatus } from "@/lib/mail";
import type { SettingsTabDef } from "@/modules/types";
import { requireSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { getMailSettings, isMailConfigured, MAIL_PASSWORD_SECRET } from "@/server/mail/settings";
import { hasSecret } from "@/server/settings";
import { resendMailAction } from "./actions";
import { MAIL_STATUS_TONE } from "./status-tone";
import { MailChecks, MailSettingsForm } from "./settings-form";

/** So viele Zeilen zeigt das Sendeprotokoll (die jüngsten); ältere stehen bis zur Aufbewahrung in der Datenbank. */
const LOG_ROWS = 50;

async function MailSettingsTab() {
  // Der Reiter gilt nur mit `mail.manage` (settingsTabsFor); die Sitzung braucht er für die eigene Adresse der Test-Mail
  const session = await requireSession();
  const { t, tp, td, date } = await getI18n();
  const [settings, hasPassword, rows] = await Promise.all([
    getMailSettings(),
    hasSecret(MAIL_PASSWORD_SECRET),
    // ohne Inhalt: `body` und `attachments` werden nie gelesen
    db.mailMessage.findMany({ orderBy: { createdAt: "desc" }, take: LOG_ROWS, select: { id: true, createdAt: true, userName: true, userId: true, toAddresses: true, subject: true, status: true, attempts: true, errorCode: true, deliveredTo: true, purpose: true } }),
  ]);
  const resendable = new Set((await db.mailMessage.findMany({ where: { id: { in: rows.filter((row) => row.status === "failed").map((row) => row.id) }, body: { not: null } }, select: { id: true } })).map((row) => row.id));
  const configured = isMailConfigured(settings);

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-3xl text-sm text-ink-muted">{t("mail.intro")}</p>
      <Alert tone={configured ? "success" : "info"} live={false} className="max-w-3xl">
        {configured ? t("mail.status.on") : t("mail.status.off")}
      </Alert>
      <MailSettingsForm initial={settings} hasPassword={hasPassword} />
      <MailChecks ownAddress={normalizeMailAddress(session.user.email ?? "")} />
      <section className="flex flex-col gap-2" aria-labelledby="mail-log-title">
        <h2 id="mail-log-title" className="text-sm font-semibold">
          {t("mail.log.title")}
        </h2>
        <p className="max-w-3xl text-sm text-ink-muted">{t("mail.log.description")}</p>
        <DataTable
          caption={t("mail.log.title")}
          rows={rows}
          rowKey={(row) => row.id}
          minWidth="44rem"
          empty={<p className="px-5 py-8 text-center text-sm text-ink-muted">{t("mail.log.empty")}</p>}
          columns={[
            { id: "time", header: t("mail.log.time"), priority: "primary", cell: (row) => date(row.createdAt, { dateStyle: "medium", timeStyle: "short" }) },
            { id: "sender", header: t("mail.log.sender"), cell: (row) => (row.userId ? row.userName : t("mail.log.system")) },
            { id: "recipient", header: t("mail.log.recipient"), cell: (row) => row.toAddresses },
            { id: "subject", header: t("mail.log.subject"), cell: (row) => row.subject },
            {
              id: "status",
              header: t("mail.log.status"),
              cell: (row) => (
                <span className="flex flex-col gap-1">
                  <StatusBadge tone={MAIL_STATUS_TONE[row.status as MailStatus] ?? "neutral"}>{td(`mail.log.status_${row.status}`, row.status)}</StatusBadge>
                  {row.errorCode ? <span className="text-xs text-ink-muted">{t("mail.log.errorCode", { reason: td(`mail.errors.code.${row.errorCode}`, row.errorCode) })}</span> : null}
                  {row.deliveredTo && row.status !== "sent" ? <span className="text-xs text-ink-muted">{t("mail.log.deliveredPartly", { done: splitAddresses(row.deliveredTo).length, total: splitAddresses(row.toAddresses).length })}</span> : null}
                  {row.attempts > 1 ? <span className="text-xs text-ink-muted">{tp("mail.log.attempts", row.attempts)}</span> : null}
                </span>
              ),
            },
            {
              id: "actions",
              header: t("common.actions"),
              hideHeader: true,
              cell: (row) =>
                resendable.has(row.id) ? (
                  <form action={resendMailAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <SubmitButton variant="secondary" size="sm">
                      {t("mail.log.resend")}
                    </SubmitButton>
                  </form>
                ) : null,
            },
          ]}
        />
      </section>
    </div>
  );
}

export const settingsTabs: SettingsTabDef[] = [{ id: "mail", feature: "admin.mail", labelKey: "mail.settings.tab", permission: "mail.manage", order: 45, Component: MailSettingsTab }];
