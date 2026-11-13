import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Alert, Badge, EmptyState, StatusBadge, TextLink } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { LinkButton } from "@/components/ui/buttons";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchInput, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { VAULT_KINDS } from "@/modules/it/docs/vault-constants";
import { listVaultEntries } from "@/modules/it/docs/vault-queries";
import { VAULT_STATE_TONE } from "@/modules/it/docs/status-tone";
import { VaultKeyringPanel } from "@/modules/it/docs/vault-keyring-panel";
import { recoveryKeyConfirmed } from "@/server/recovery-key";
import { vaultStatus } from "@/server/vault-keyring";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.title") };
}

/**
 * IT-Tresor (Recht `docs.vault`, auch Administratoren nur ausdrücklich): Liste mit Titel, Art, System und Zustand. Zugangsdaten stehen hier nie – nicht einmal der Benutzername; sie erscheinen
 * auf der Detailseite nur nach „Anzeigen“ mit erneuter Passwortabfrage. Ohne gesicherten Wiederherstellungsschlüssel warnt die Seite, denn dann sind die Einträge nach einem Datenträgerverlust verloren.
 */
export default async function VaultPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const session = await requirePermission("docs.vault");
  const [{ t, tp, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const [entries, keyConfirmed, keyring] = await Promise.all([listVaultEntries({ q: sp.q, kind: sp.kind }), recoveryKeyConfirmed(), vaultStatus()]);
  const canManage = session.can("docs.vaultManage");
  const filtered = Boolean(sp.q?.trim() || sp.kind);

  return (
    <>
      <PageHeader
        help="it.vault"
        title={t("vault.title")}
        description={t("vault.description")}
        actions={
          canManage ? (
            <LinkButton href="/docs/vault/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("vault.new")}
            </LinkButton>
          ) : null
        }
      />
      <div className="flex max-w-5xl flex-col gap-5">
        <Alert tone="info">{t("vault.intro")}</Alert>
        {/* Tresor-Schlüssel: einrichten, entsperren (nach jedem Neustart), sperren, Passphrase ändern, zurücksetzen */}
        <VaultKeyringPanel
          canManage={canManage && session.can("docs.vault")}
          view={{ state: keyring.state, recovery: keyring.recovery, since: keyring.unlockedSince ? date(keyring.unlockedSince, { dateStyle: "medium", timeStyle: "short" }) : null, by: keyring.unlockedByName }}
        />
        {keyring.state !== "notSetUp" && !keyring.recovery ? (
          <Alert tone="warning">
            {t("vault.noRecoveryWrap")}{" "}
            {session.user.isAdmin ? <TextLink href="/admin/backup/key">{t("vault.keyWarningLink")}</TextLink> : t("vault.keyWarningAdmin")}
          </Alert>
        ) : null}
        {!keyConfirmed ? (
          <Alert tone="warning">
            {t("vault.keyWarning")}{" "}
            {session.user.isAdmin ? (
              <TextLink href="/admin/backup/key">{t("vault.keyWarningLink")}</TextLink>
            ) : (
              t("vault.keyWarningAdmin")
            )}
          </Alert>
        ) : null}

        <FilterBar
          columns="sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
          active={filtered}
          extrasOpen={Boolean(sp.kind)}
          resetHref="/docs/vault"
          search={<SearchInput name="q" defaultValue={sp.q ?? ""} placeholder={t("vault.searchPlaceholder")} aria-label={t("common.search")} />}
        >
          <Select name="kind" defaultValue={sp.kind ?? ""} aria-label={t("vault.fields.kind")}>
            <option value="">{t("vault.filters.anyKind")}</option>
            {VAULT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`vault.kind.${kind}`)}
              </option>
            ))}
          </Select>
        </FilterBar>

        <DataTable
          caption={t("vault.title")}
          rows={entries}
          rowKey={(e) => e.id}
          rowHref={(e) => `/docs/vault/${e.id}`}
          minWidth="40rem"
          summary={tp("vault.count", entries.length)}
          empty={<EmptyState title={t("vault.empty")} hint={filtered ? undefined : t("vault.emptyHint")} />}
          columns={[
            { id: "title", header: t("vault.cols.title"), priority: "primary", cell: (e) => e.title, sub: (e) => (e.system ? <span>{e.system}</span> : null) },
            { id: "kind", header: t("vault.cols.kind"), cell: (e) => <Badge>{t(`vault.kind.${e.kind}`)}</Badge> },
            { id: "state", header: t("vault.cols.state"), cell: (e) => <StatusBadge tone={VAULT_STATE_TONE[e.state]}>{t(`vault.state.${e.state}`)}</StatusBadge> },
            { id: "changed", header: t("vault.cols.changed"), cell: (e) => date(e.updatedAt, { dateStyle: "medium" }), sub: (e) => (e.updatedByName ? <span>{e.updatedByName}</span> : null) },
          ]}
        />
      </div>
    </>
  );
}
