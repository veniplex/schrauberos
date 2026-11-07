import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { versionOf } from "@/lib/concurrency";
import { scaledToInput } from "@/lib/line-items";
import { ArticleForm } from "@/modules/workshop/parts/article-form";
import { getArticle } from "@/modules/workshop/parts/queries";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  if (!(await sessionIfAllowed("parts.edit"))) return {};
  const article = await db.article.findUnique({ where: { id }, select: { number: true } });
  return { title: article ? `${article.number} · ${t("parts.edit")}` : t("parts.edit") };
}

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("parts.edit");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const article = await getArticle(session, id);
  if (!article) notFound();
  const showPrices = session.can("parts.prices");
  return (
    <>
      <PageHeader back={{ href: `/parts/${article.id}`, label: article.number }} help="workshop.parts" title={i18n.t("parts.edit")} description={article.name} />
      <ArticleForm
        initial={{
          id: article.id,
          version: versionOf(article),
          number: article.number,
          name: article.name,
          unit: article.unit,
          supplier: article.supplier ?? "",
          taxRate: scaledToInput(article.taxBp, 2, i18n.locale),
          minStock: article.minStockMilli ? scaledToInput(article.minStockMilli, 3, i18n.locale) : "",
          notes: article.notes ?? "",
          ...(showPrices ? { purchaseCents: article.purchaseCents ?? null, saleCents: article.saleCents ?? null } : {}),
        }}
        cancelHref={`/parts/${article.id}`}
        showPrices={showPrices}
      />
    </>
  );
}
