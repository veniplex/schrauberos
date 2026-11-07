import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardCheck, PackagePlus, Pencil } from "lucide-react";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Alert, Card, DefinitionList, StatusBadge, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { INTL_LOCALE } from "@/i18n/config";
import { getI18n } from "@/i18n/server";
import { versionOf } from "@/lib/concurrency";
import { formatCents } from "@/lib/money";
import { setArticleArchived } from "@/modules/workshop/parts/actions";
import { stockState } from "@/modules/workshop/parts/domain";
import { getArticle, listMovements } from "@/modules/workshop/parts/queries";
import { MOVEMENT_TONE, STOCK_TONE } from "@/modules/workshop/parts/status-tone";
import type { MovementKind } from "@/modules/workshop/parts/constants";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  if (!(await sessionIfAllowed("parts.view"))) return {};
  const article = await db.article.findUnique({ where: { id }, select: { number: true, name: true } });
  return { title: article ? `${article.number} · ${article.name}` : t("parts.title") };
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("parts.view");
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const { t, td, date, locale } = i18n;
  const article = await getArticle(session, id);
  if (!article) notFound();
  const movements = await listMovements(session, article.id);
  const state = stockState(article.stockMilli, article.minStockMilli);
  const qty = (milli: number) => i18n.number(milli / 1000, { maximumFractionDigits: 3 });
  const money = (cents: number | null | undefined) => (cents == null ? null : formatCents(cents, INTL_LOCALE[locale]));
  const canEdit = session.can("parts.edit");
  const invoicesActive = session.features.has("office.invoices") && session.can("invoices.view");

  return (
    <>
      <PageHeader
        back={{ href: "/parts", label: t("nav.parts") }}
        help="workshop.parts"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular">{article.number}</span>
            <span>{article.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STOCK_TONE[state]}>{t(`parts.stockState.${state}`)}</StatusBadge>
            <span className="tabular">{`${qty(article.stockMilli)} ${article.unit}`}</span>
          </span>
        }
        actions={
          <>
            {session.can("parts.stock") && !article.archivedAt ? (
              <LinkButton href={`/parts/receipt?article=${article.id}`} variant="secondary">
                <PackagePlus className="size-4" aria-hidden /> {t("parts.actions.receipt")}
              </LinkButton>
            ) : null}
            {canEdit ? (
              <LinkButton href={`/parts/${article.id}/edit`} variant="secondary">
                <Pencil className="size-4" aria-hidden /> {t("common.edit")}
              </LinkButton>
            ) : null}
          </>
        }
      />

      {article.archivedAt ? <Alert tone="info" className="mb-5">{t("parts.stock.archivedNote")}</Alert> : null}
      {state === "negative" ? <Alert tone="warning" className="mb-5">{t("parts.stockState.negative")}: {`${qty(article.stockMilli)} ${article.unit}`}</Alert> : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="min-w-0 md:col-span-2">
          <Card title={t("parts.sections.movements")} padded={false}>
            <DataTable
              bare
              caption={t("parts.sections.movements")}
              rows={movements}
              rowKey={(m) => m.id}
              empty={<p className="px-5 py-4 text-sm text-ink-muted">{t("parts.movements.empty")}</p>}
              columns={[
                { id: "time", header: t("parts.movements.cols.time"), priority: "primary", cell: (m) => date(m.createdAt, { dateStyle: "medium", timeStyle: "short" }), sub: (m) => m.byName },
                { id: "kind", header: t("parts.movements.cols.kind"), cell: (m) => <StatusBadge tone={MOVEMENT_TONE[m.kind as MovementKind] ?? "neutral"}>{td(`parts.movements.kinds.${m.kind}`, m.kind)}</StatusBadge> },
                { id: "quantity", header: t("parts.movements.cols.quantity"), align: "end", cell: (m) => <span className="tabular">{`${m.quantityMilli > 0 ? "+" : ""}${qty(m.quantityMilli)}`}</span> },
                { id: "after", header: t("parts.movements.cols.after"), align: "end", priority: "low", cell: (m) => <span className="tabular">{qty(m.stockAfterMilli)}</span> },
                {
                  id: "reference",
                  header: t("parts.movements.cols.reference"),
                  priority: "low",
                  cell: (m) =>
                    m.orderId && session.features.has("workshop.orders") && session.can("orders.view") ? (
                      <TextLink href={`/orders/${m.orderId}`}>{t("parts.movements.order", { number: m.orderNumber ?? "" })}</TextLink>
                    ) : m.orderNumber ? (
                      t("parts.movements.order", { number: m.orderNumber })
                    ) : m.reference ? (
                      invoicesActive ? <TextLink href={`/invoices?q=${encodeURIComponent(m.reference)}`}>{m.reference}</TextLink> : m.reference
                    ) : (
                      "–"
                    ),
                },
              ]}
            />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title={t("parts.sections.stock")}>
            <DefinitionList
              items={[
                { label: t("parts.stock.current"), value: `${qty(article.stockMilli)} ${article.unit}` },
                { label: t("parts.stock.min"), value: article.minStockMilli ? `${qty(article.minStockMilli)} ${article.unit}` : null },
                { label: t("parts.fields.supplier"), value: article.supplier },
                ...(session.can("parts.prices")
                  ? [
                      { label: t("parts.fields.purchase"), value: money(article.purchaseCents) },
                      { label: t("parts.fields.sale"), value: money(article.saleCents) },
                    ]
                  : []),
                { label: t("parts.fields.taxRate"), value: `${i18n.number(article.taxBp / 100)} %` },
                { label: t("common.notes"), value: article.notes },
              ]}
            />
          </Card>

          {session.can("parts.stock") || canEdit ? (
            <Card title={t("parts.sections.actions")}>
              <div className="flex flex-wrap gap-2">
                {session.can("parts.stock") ? (
                  <LinkButton href="/parts/count" variant="secondary" size="sm">
                    <ClipboardCheck className="size-4" aria-hidden /> {t("parts.actions.count")}
                  </LinkButton>
                ) : null}
                {canEdit ? (
                  <form action={setArticleArchived}>
                    <input type="hidden" name="id" value={article.id} />
                    <input type="hidden" name="version" value={versionOf(article)} />
                    <input type="hidden" name="archived" value={article.archivedAt ? "0" : "1"} />
                    {article.archivedAt ? (
                      <SubmitButton variant="secondary" size="sm">
                        {t("parts.actions.unarchive")}
                      </SubmitButton>
                    ) : (
                      <ConfirmSubmitButton message={t("parts.actions.archiveConfirm")} variant="secondary" size="sm">
                        {t("parts.actions.archive")}
                      </ConfirmSubmitButton>
                    )}
                  </form>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
