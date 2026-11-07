import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/buttons";
import { Alert, EmptyState } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { CountForm } from "@/modules/workshop/parts/stock-forms";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("parts.count.title") };
}

/** Artikel je Seite der Inventur (nach Artikelnummer sortiert); darüber geht es mit „Weiter mit den nächsten Artikeln“ (`?from=<letzte Nummer>`) weiter. */
const PAGE_SIZE = 500;

/** Inventur: aktive Artikel mit Sollbestand und Eingabe „gezählt“, höchstens 500 je Seite; gibt es mehr, sagt die Seite es und führt zur nächsten. */
export default async function CountPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requirePermission("parts.stock");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t } = i18n;
  const from = typeof sp.from === "string" ? sp.from.slice(0, 40) : "";
  const where = { archivedAt: null, ...(from ? { number: { gt: from } } : {}) };
  const [articles, remaining] = await Promise.all([
    db.article.findMany({ where, orderBy: { number: "asc" }, take: PAGE_SIZE, select: { id: true, number: true, name: true, unit: true, stockMilli: true } }),
    db.article.count({ where }),
  ]);
  const more = remaining > articles.length;
  return (
    <>
      <PageHeader back={{ href: "/parts", label: t("nav.parts") }} help="workshop.parts" title={t("parts.count.title")} description={t("parts.count.description")} />
      {articles.length === 0 ? (
        <EmptyState title={t("parts.count.empty")} />
      ) : (
        <CountForm
          rows={articles.map((a) => ({ id: a.id, number: a.number, name: a.name, unit: a.unit, stock: i18n.number(a.stockMilli / 1000, { maximumFractionDigits: 3 }) }))}
          cancelHref="/parts"
          draftKey={from ? `count:${from}` : "count"}
          notice={
            more ? (
              <Alert tone="info" className="mb-3">
                <p>{t("parts.count.truncated", { shown: articles.length, total: remaining })}</p>
                <LinkButton href={`/parts/count?from=${encodeURIComponent(articles[articles.length - 1].number)}`} variant="secondary" className="mt-2">
                  {t("parts.count.next")}
                </LinkButton>
              </Alert>
            ) : null
          }
        />
      )}
    </>
  );
}
