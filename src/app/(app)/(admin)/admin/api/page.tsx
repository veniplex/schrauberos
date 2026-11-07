import type { Metadata } from "next";
import { KeyRound, Trash2 } from "lucide-react";
import { Alert, Badge, EmptyState, StatusBadge } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { LinkButton } from "@/components/ui/buttons";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { MARKED_PERMISSIONS } from "@/modules/catalog";
import { ApiTabs } from "@/modules/admin/api/api-tabs";
import { revokeApiToken } from "@/modules/admin/api/actions";
import { TOKEN_STATUS_TONE, tokenStatusOf } from "@/modules/admin/api/status-tone";
import { listApiTokens } from "@/server/api/tokens";
import { requirePermission } from "@/server/auth/session";
import { isBehindProxy } from "@/server/auth/network";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("api.title") };
}

/** API-Tokens (Recht `api.manage`): Liste mit Besitzer, Rechten, Ablauf, letzter Benutzung und Widerruf. Der Klartext eines Tokens ist nie wieder sichtbar. */
export default async function ApiTokensPage() {
  await requirePermission("api.manage");
  const { t, td, date } = await getI18n();
  const [tokens, behindProxy] = await Promise.all([listApiTokens(), isBehindProxy()]);
  const day = (d: Date) => date(d, { dateStyle: "medium" });
  const stamp = (d: Date) => date(d, { dateStyle: "medium", timeStyle: "short" });
  const restricted = tokens.some((token) => token.allowedNets && tokenStatusOf(token) === "active");

  return (
    <>
      <PageHeader
        title={t("api.title")}
        description={t("api.description")}
        help="admin.api"
        actions={
          <LinkButton variant="primary" href="/admin/api/tokens/new">
            <KeyRound className="size-4" aria-hidden /> {t("api.tokens.new")}
          </LinkButton>
        }
      />
      <ApiTabs active="tokens" />
      <div className="flex max-w-5xl flex-col gap-5">
        <Alert tone="info">
          <p>{t("api.tokens.intro")}</p>
          <p className="mt-1">{t("api.tokens.revokedWhen")}</p>
        </Alert>
        {restricted && !behindProxy ? <Alert tone="warning">{t("api.tokens.netsNoProxy")}</Alert> : null}

        <DataTable
          caption={t("api.tokens.list.title")}
          rows={tokens}
          rowKey={(token) => token.id}
          minWidth="56rem"
          empty={<EmptyState title={t("api.tokens.list.empty")} hint={t("api.tokens.list.emptyHint")} />}
          columns={[
            {
              id: "name",
              header: t("api.tokens.list.name"),
              priority: "primary",
              cell: (token) => token.name,
              sub: (token) => (
                <span className="flex flex-col gap-0.5">
                  {token.description ? <span>{token.description}</span> : null}
                  <code className="text-[11px]">{token.hint}</code>
                </span>
              ),
            },
            {
              id: "owner",
              header: t("api.tokens.list.owner"),
              cell: (token) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  {token.ownerName}
                  {token.ownerIsService ? <Badge>{t("api.tokens.list.ownerService")}</Badge> : null}
                </span>
              ),
            },
            {
              id: "rights",
              header: t("api.tokens.list.rights"),
              cell: (token) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="tabular">{t("api.tokens.list.rightsCount", { count: token.scope.length })}</span>
                  {token.scope.some((p) => MARKED_PERMISSIONS.has(p)) ? <Badge tone="warning">{t("api.tokens.list.marked")}</Badge> : null}
                  {token.scope.some((p) => !p.endsWith(".view")) ? <Badge>{t("api.tokens.list.writes")}</Badge> : <Badge tone="success">{t("api.tokens.list.readOnly")}</Badge>}
                </span>
              ),
            },
            {
              id: "status",
              header: t("api.tokens.list.status"),
              cell: (token) => {
                const status = tokenStatusOf(token);
                return (
                  <span className="flex flex-col gap-1">
                    <StatusBadge tone={TOKEN_STATUS_TONE[status]}>{td(`api.tokens.status.${status}`, status)}</StatusBadge>
                    <span className="text-xs text-ink-muted">{status === "revoked" && token.revokedAt ? day(token.revokedAt) : t("api.tokens.list.until", { date: day(token.expiresAt) })}</span>
                  </span>
                );
              },
            },
            { id: "lastUsed", header: t("api.tokens.list.lastUsed"), cell: (token) => <span className="text-ink-muted">{token.lastUsedAt ? stamp(token.lastUsedAt) : t("api.tokens.list.never")}</span> },
            {
              id: "network",
              header: t("api.tokens.list.network"),
              priority: "low",
              cell: (token) =>
                token.allowedNets ? (
                  <span title={token.allowedNets}>
                    <Badge>{t("api.tokens.list.netsCount", { count: token.allowedNets.split("\n").length })}</Badge>
                  </span>
                ) : (
                  <span className="text-ink-muted">{t("api.tokens.list.anywhere")}</span>
                ),
            },
            {
              id: "actions",
              header: t("common.actions"),
              hideHeader: true,
              align: "end",
              cell: (token) =>
                tokenStatusOf(token) === "active" ? (
                  <form action={revokeApiToken}>
                    <input type="hidden" name="id" value={token.id} />
                    <ConfirmSubmitButton message={t("api.tokens.revokeConfirm")} label={t("api.tokens.revoke")} target={token.name}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </ConfirmSubmitButton>
                  </form>
                ) : null,
            },
          ]}
        />
        <p className="text-xs text-ink-muted">{t("api.tokens.note")}</p>
      </div>
    </>
  );
}
