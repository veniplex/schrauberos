import { Alert, Card, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { SectionDef, SectionProps } from "@/modules/types";
import { isOrderOpen, orderLines } from "@/modules/workshop/orders/public";
import { ArticlePicker } from "./article-picker";
import { shortages } from "./domain";
import { consumedParts } from "./queries";
import { STOCK_TONE } from "./status-tone";

/**
 * Beitrag zur Auftragsseite: „Verbrauchte Teile“ – die Positionen des Auftrags mit Artikelverweis, ob sie schon vom Lager abgebucht sind und – vor dem Abschluss – ob der Bestand reicht.
 * Reicht er nicht, bleibt das ein Hinweis: Der Auftrag lässt sich trotzdem abschließen, der Bestand wird dann negativ (und im Lager sichtbar).
 */
async function ConsumedParts({ entityId, session }: SectionProps) {
  const [{ t, tp, number }, order] = await Promise.all([getI18n(), orderLines(entityId)]);
  if (!order) return null;
  const rows = await consumedParts(order.id, order.items);
  if (rows.length === 0) return null;
  const open = isOrderOpen(order.status);
  // Der Bestand wird je Artikel gegen die Summe aller Positionen mit diesem Artikel geprüft (zwei Positionen à 3 bei Bestand 4 reichen nicht)
  const short = open ? shortages(rows.map((r) => ({ refId: r.line.refId!, quantityMilli: r.line.quantityMilli })), new Map(rows.filter((r) => r.article).map((r) => [r.article!.id, r.article!.stockMilli]))) : new Set<string>();
  const qty = (milli: number) => number(milli / 1000, { maximumFractionDigits: 3 });

  return (
    <Card title={t("parts.consumed.title")}>
      {short.size > 0 ? (
        <Alert tone="warning" className="mb-4">
          {tp("parts.consumed.shortage", short.size)}
        </Alert>
      ) : null}
      <ul className="flex flex-col divide-y divide-line text-sm">
        {rows.map(({ line, article, bookedMilli }) => {
          const booked = bookedMilli > 0;
          const state = !article ? "negative" : article.stockMilli < 0 ? "negative" : open && short.has(article.id) ? "low" : "ok";
          return (
            <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {article && session.can("parts.view") ? <TextLink href={`/parts/${article.id}`}>{article.name}</TextLink> : line.description}
                </p>
                <p className="text-xs text-ink-muted">
                  {qty(line.quantityMilli)} {line.unit || article?.unit || ""}
                  {article ? ` · ${t("parts.consumed.stock", { stock: qty(article.stockMilli), unit: article.unit })}` : ""}
                </p>
              </div>
              <span className="flex flex-wrap items-center gap-2">
                {state !== "ok" ? <StatusBadge tone={STOCK_TONE[state]}>{!article ? t("parts.consumed.unknown") : article.stockMilli < 0 ? t("parts.stockState.negative") : t("parts.consumed.notEnough")}</StatusBadge> : null}
                <StatusBadge tone={booked ? "success" : "neutral"}>{booked ? t("parts.consumed.booked") : t("parts.consumed.pending")}</StatusBadge>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export const sections: SectionDef[] = [
  { id: "parts-consumed", feature: "workshop.parts", host: "orders/detail", permission: "parts.view", order: 20, Component: ConsumedParts },
  { id: "parts-picker", feature: "workshop.parts", host: "orders/items", permission: "parts.view", order: 20, Component: () => <ArticlePicker /> },
];
