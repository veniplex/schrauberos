import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { redirect } from "next/navigation";
import { VaultForm } from "@/modules/it/docs/vault-form";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.new") };
}

export default async function NewVaultEntryPage() {
  const session = await requirePermission("docsIt.vaultManage");
  // Verwalten setzt das Ansehen voraus (wie in der Operation)
  if (!session.can("docsIt.vault")) redirect("/forbidden");
  const { t } = await getI18n();
  return (
    <>
      <PageHeader back={{ href: "/docs/vault", label: t("vault.title") }} help="it.vault" title={t("vault.new")} />
      <VaultForm cancelHref="/docs/vault" initial={{ title: "", kind: "server", system: "" }} />
    </>
  );
}
