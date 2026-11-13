import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { redirect } from "next/navigation";
import { VaultForm } from "@/modules/it/docs/vault-form";
import { Alert } from "@/components/ui/layout";
import { requirePermission } from "@/server/auth/session";
import { vaultStatus } from "@/server/vault-keyring";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vault.new") };
}

export default async function NewVaultEntryPage() {
  const session = await requirePermission("docsIt.vaultManage");
  // Verwalten setzt das Ansehen voraus (wie in der Operation)
  if (!session.can("docsIt.vault")) redirect("/forbidden");
  const { t } = await getI18n();
  const keyring = await vaultStatus();
  return (
    <>
      <PageHeader back={{ href: "/docs/vault", label: t("vault.title") }} help="it.vault" title={t("vault.new")} />
      {keyring.state !== "unlocked" ? <Alert tone="warning" className="mb-5 max-w-3xl">{t(keyring.state === "locked" ? "vault.errors.locked" : "vault.errors.notSetUp")}</Alert> : null}
      <VaultForm cancelHref="/docs/vault" initial={{ title: "", kind: "server", system: "" }} />
    </>
  );
}
