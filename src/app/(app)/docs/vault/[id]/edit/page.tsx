import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { VaultForm } from "@/modules/it/docs/vault-form";
import { getVaultEntry } from "@/modules/it/docs/vault-queries";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.edit") };
}

export default async function EditVaultEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("docsIt.vaultManage");
  if (!session.can("docsIt.vault")) redirect("/forbidden");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const entry = await getVaultEntry(id);
  if (!entry) notFound();
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/docs/vault", label: t("vault.title") }, { href: `/docs/vault/${entry.id}`, label: entry.title }]} help="it.vault" title={t("vault.edit")} description={entry.title} />
      <VaultForm cancelHref={`/docs/vault/${entry.id}`} initial={{ id: entry.id, version: entry.version, title: entry.title, kind: entry.kind, system: entry.system ?? "", state: entry.state }} />
    </>
  );
}
