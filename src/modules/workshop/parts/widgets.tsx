import Link from "next/link";
import { Card, EmptyState, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { WidgetDef } from "@/modules/types";
import { stockState } from "./domain";
import { lowStockArticles } from "./queries";
import { STOCK_TONE } from "./status-tone";

/** Artikel unter dem Mindestbestand (und mit negativem Bestand) – was nachbestellt werden sollte. */
export async function LowStockWidget() {
  const [{ t, tp, number }, articles] = await Promise.all([getI18n(), lowStockArticles()]);
  const qty = (milli: number) => number(milli / 1000, { maximumFractionDigits: 3 });
  return (
    <Card
      headingLevel={3}
      title={t("parts.widgets.lowTitle")}
      actions={
        <TextLink href="/parts?stock=low" className="text-sm">
          {t("common.showAll")}
        </TextLink>
      }
      padded={false}
    >
      {articles.length === 0 ? (
        <EmptyState title={t("parts.widgets.lowEmpty")} />
      ) : (
        <>
          <p className="px-5 pt-3 text-sm text-ink-muted">{tp("parts.widgets.lowCount", articles.length)}</p>
          <ul className="divide-y divide-line">
            {articles.map((a) => {
              const state = stockState(a.stockMilli, a.minStockMilli);
              return (
                <li key={a.id}>
                  <Link href={`/parts/${a.id}`} className="flex min-h-(--tap-row) items-center justify-between gap-3 px-5 py-3 hover:bg-surface-hover">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.name}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        <span className="tabular">{a.number}</span> · {t("parts.widgets.stockOfMin", { stock: qty(a.stockMilli), min: qty(a.minStockMilli), unit: a.unit })}
                      </p>
                    </div>
                    <StatusBadge tone={STOCK_TONE[state]}>{state === "negative" ? t("parts.stockState.negative") : t("parts.stockState.low")}</StatusBadge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

export const widgets: WidgetDef[] = [
  { id: "parts-low", titleKey: "parts.widgets.lowTitle", priority: 28, feature: "workshop.parts", permission: "parts.view", span: 1, order: 25, Component: LowStockWidget },
];
