import { ARTICLE_REF } from "./constants";

/**
 * Artikelnummer: getrimmt, Großbuchstaben, Leerzeichen und Bindestrich-Folgen innerhalb bleiben. Eindeutig ist die so normalisierte Nummer (`OF-123` und `of-123` sind derselbe Artikel).
 */
export const normalizeArticleNumber = (value: string): string => value.trim().replace(/\s+/g, " ").toUpperCase();

export type StockState = "negative" | "low" | "ok";

/** Bestandszustand: negativ (erlaubt, aber sichtbar), unter oder auf dem Mindestbestand (nur wenn einer festgelegt ist), sonst in Ordnung. */
export function stockState(stockMilli: number, minStockMilli: number): StockState {
  if (stockMilli < 0) return "negative";
  return minStockMilli > 0 && stockMilli <= minStockMilli ? "low" : "ok";
}

export type ClosedLine = { id: string; kind: string; description: string; quantityMilli: number; refType: string | null; refId: string | null };

/** Positionen eines Auftrags, die Lagerware sind: Art „Teil“ mit Verweis auf einen Artikel. Nur sie werden bei Abschluss gebucht. */
export const bookableLines = <T extends ClosedLine>(items: readonly T[]): Array<T & { refId: string }> =>
  items.filter((item): item is T & { refId: string } => item.kind === "part" && item.refType === ARTICLE_REF && !!item.refId && item.quantityMilli !== 0);

/** Mengen je Artikel zusammenfassen (derselbe Artikel kann in mehreren Positionen stehen). */
export function sumByArticle(lines: ReadonlyArray<{ refId: string; quantityMilli: number }>): Map<string, number> {
  const sums = new Map<string, number>();
  for (const line of lines) sums.set(line.refId, (sums.get(line.refId) ?? 0) + line.quantityMilli);
  return sums;
}

/**
 * Was beim Wiederöffnen zurückzubuchen ist: je Artikel der Saldo der bisherigen Bewegungen zu diesem Auftrag (Abgänge negativ, Rückbuchungen positiv). Ein negativer Saldo wird mit
 * dem Gegenwert zurückgebucht; Saldo 0 (schon zurückgebucht) ergibt nichts – das Wiederöffnen ist so auch bei mehrfachem Abschließen richtig.
 */
export function reversalsFor(movements: ReadonlyArray<{ articleId: string; quantityMilli: number }>): Map<string, number> {
  const balance = new Map<string, number>();
  for (const m of movements) balance.set(m.articleId, (balance.get(m.articleId) ?? 0) + m.quantityMilli);
  const out = new Map<string, number>();
  for (const [articleId, saldo] of balance) if (saldo < 0) out.set(articleId, -saldo);
  return out;
}

/** Bestand in der Einheit des Artikels für die Anzeige (Tausendstel → Zahl). */
export const fromMilli = (milli: number): number => milli / 1000;
