import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { ReceiptForm, type ArticleOption } from "@/modules/workshop/parts/stock-forms";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("parts.receipt.title") };
}

/** Wareneingang buchen; mit `?article=` ist der Artikel vorgewählt (Knopf auf der Artikelseite). */
export default async function ReceiptPage({ searchParams }: { searchParams: Promise<{ article?: string }> }) {
  await requirePermission("parts.stock");
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const found = sp.article ? await db.article.findFirst({ where: { id: sp.article, archivedAt: null }, select: { id: true, number: true, name: true, unit: true } }) : null;
  const article: ArticleOption | null = found ? { id: found.id, label: found.number, sublabel: found.name, number: found.number, unit: found.unit } : null;
  return (
    <>
      <PageHeader back={{ href: article ? `/parts/${article.id}` : "/parts", label: article ? article.number : t("nav.parts") }} help="workshop.parts" title={t("parts.receipt.title")} description={t("parts.receipt.description")} />
      <ReceiptForm article={article} cancelHref={article ? `/parts/${article.id}` : "/parts"} />
    </>
  );
}
