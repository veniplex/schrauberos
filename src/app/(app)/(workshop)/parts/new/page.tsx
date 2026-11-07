import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { ArticleForm } from "@/modules/workshop/parts/article-form";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("parts.new") };
}

export default async function NewArticlePage() {
  const session = await requirePermission("parts.edit");
  const { t } = await getI18n();
  return (
    <>
      <PageHeader back={{ href: "/parts", label: t("nav.parts") }} help="workshop.parts" title={t("parts.new")} description={t("parts.newDescription")} />
      <ArticleForm initial={{ number: "", name: "", unit: "Stk", supplier: "", taxRate: "19", minStock: "", notes: "" }} cancelHref="/parts" showPrices={session.can("parts.prices")} />
    </>
  );
}
