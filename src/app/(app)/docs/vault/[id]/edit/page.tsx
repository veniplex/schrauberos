import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { VaultForm } from "@/modules/it/docs/vault-form";
import { getVaultEntry } from "@/modules/it/docs/vault-queries";
import { Alert } from "@/components/ui/layout";
import { requirePermission } from "@/server/auth/session";
import { vaultStatus } from "@/server/vault-keyring";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.edit") };
}

export default async function EditVaultEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("docs.vaultManage");
  if (!session.can("docs.vault")) redirect("/forbidden");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const entry = await getVaultEntry(id);
  if (!entry) notFound();
  const keyring = await vaultStatus();
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/docs/vault", label: t("vault.title") }, { href: `/docs/vault/${entry.id}`, label: entry.title }]} help="it.vault" title={t("vault.edit")} description={entry.title} />
      {keyring.state !== "unlocked" ? <Alert tone="warning" className="mb-5 max-w-3xl">{t(keyring.state === "locked" ? "vault.errors.locked" : "vault.errors.notSetUp")}</Alert> : null}
      <VaultForm cancelHref={`/docs/vault/${entry.id}`} initial={{ id: entry.id, version: entry.version, title: entry.title, kind: entry.kind, system: entry.system ?? "", state: entry.state }} />
    </>
  );
}
