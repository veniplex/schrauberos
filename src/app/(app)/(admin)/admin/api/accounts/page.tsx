import type { Metadata } from "next";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { Alert, EmptyState, StatusBadge } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Button, LinkButton } from "@/components/ui/buttons";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { deleteServiceAccount, setServiceAccountActive } from "@/modules/admin/api/actions";
import { ApiTabs } from "@/modules/admin/api/api-tabs";
import { listServiceAccounts, MAX_SERVICE_ACCOUNTS } from "@/server/api/service-accounts";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("api.accounts.title") };
}

/** Dienstkonten (Recht `api.manage`): Konten ohne Passwort und Anmeldung, die nur API-Tokens tragen. Ausschalten und Löschen beenden alle Tokens des Kontos; Einschalten verlangt das Passwort. */
export default async function ServiceAccountsPage() {
  await requirePermission("api.manage");
  const { t } = await getI18n();
  const accounts = await listServiceAccounts();
  return (
    <>
      <PageHeader
        title={t("api.title")}
        description={t("api.description")}
        help="admin.api"
        actions={
          accounts.length < MAX_SERVICE_ACCOUNTS ? (
            <LinkButton variant="primary" href="/admin/api/accounts/new">
              <Plus className="size-4" aria-hidden /> {t("api.accounts.new")}
            </LinkButton>
          ) : null
        }
      />
      <ApiTabs active="accounts" />
      <div className="flex max-w-5xl flex-col gap-5">
        <Alert tone="info">{t("api.accounts.intro")}</Alert>
        <DataTable
          caption={t("api.accounts.list.title")}
          rows={accounts}
          rowKey={(a) => a.id}
          minWidth="48rem"
          empty={<EmptyState title={t("api.accounts.empty")} hint={t("api.accounts.emptyHint")} />}
          columns={[
            { id: "name", header: t("api.accounts.list.name"), priority: "primary", cell: (a) => a.name, sub: (a) => <code className="text-[11px]">{a.username}</code> },
            { id: "roles", header: t("api.accounts.list.roles"), cell: (a) => <span className="text-sm">{a.roleNames.join(", ") || "–"}</span> },
            { id: "tokens", header: t("api.accounts.list.tokens"), cell: (a) => <span className="tabular text-ink-muted">{t("api.accounts.list.tokensCount", { count: a.activeTokens })}</span> },
            { id: "state", header: t("api.accounts.list.state"), cell: (a) => <StatusBadge tone={a.active ? "success" : "neutral"}>{a.active ? t("api.accounts.list.on") : t("api.accounts.list.off")}</StatusBadge> },
            {
              id: "actions",
              header: t("common.actions"),
              hideHeader: true,
              align: "end",
              cell: (a) => (
                <span className="flex flex-wrap items-center justify-end gap-2">
                  {a.active ? (
                    <>
                      <LinkButton href="/admin/api/tokens/new">
                        <KeyRound className="size-3.5" aria-hidden /> {t("api.accounts.list.newToken")}
                      </LinkButton>
                      <form action={setServiceAccountActive}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="active" value="false" />
                        <ConfirmSubmitButton message={t("api.accounts.list.turnOffHint")} label={t("api.accounts.list.turnOff")} target={a.name}>
                          {t("api.accounts.list.turnOff")}
                        </ConfirmSubmitButton>
                      </form>
                    </>
                  ) : (
                    <form action={setServiceAccountActive} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="active" value="true" />
                      <Input name="password" type="password" maxLength={128} autoComplete="current-password" required aria-label={`${t("api.accounts.list.passwordLabel")}: ${a.name}`} placeholder={t("api.accounts.list.passwordLabel")} />
                      <Button type="submit">{t("api.accounts.list.turnOn")}</Button>
                    </form>
                  )}
                  <form action={deleteServiceAccount}>
                    <input type="hidden" name="id" value={a.id} />
                    <ConfirmSubmitButton message={t("api.accounts.delete.confirm")} label={t("api.accounts.delete.action")} target={a.name}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </ConfirmSubmitButton>
                  </form>
                </span>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}
