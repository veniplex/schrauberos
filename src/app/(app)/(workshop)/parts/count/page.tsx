import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { CountForm } from "@/modules/workshop/parts/stock-forms";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("parts.count.title") };
}

/** Inventur: alle aktiven Artikel mit Sollbestand und Eingabe „gezählt“ (die Zahl der Artikel ist klein; die Seite zeigt höchstens 500). */
export default async function CountPage() {
  await requirePermission("parts.stock");
  const i18n = await getI18n();
  const { t } = i18n;
  const articles = await db.article.findMany({ where: { archivedAt: null }, orderBy: { number: "asc" }, take: 500, select: { id: true, number: true, name: true, unit: true, stockMilli: true } });
  return (
    <>
      <PageHeader back={{ href: "/parts", label: t("nav.parts") }} help="workshop.parts" title={t("parts.count.title")} description={t("parts.count.description")} />
      {articles.length === 0 ? (
        <EmptyState title={t("parts.count.empty")} />
      ) : (
        <CountForm rows={articles.map((a) => ({ id: a.id, number: a.number, name: a.name, unit: a.unit, stock: i18n.number(a.stockMilli / 1000, { maximumFractionDigits: 3 }) }))} cancelHref="/parts" />
      )}
    </>
  );
}
