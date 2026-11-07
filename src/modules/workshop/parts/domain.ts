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

/** Bilanz der bisherigen Bewegungen eines Auftrags je Artikel (Abgänge negativ, Rückbuchungen positiv; Bewegungsarten `order` und `reversal`). */
export function orderBalance(movements: ReadonlyArray<{ articleId: string; quantityMilli: number }>): Map<string, number> {
  const balance = new Map<string, number>();
  for (const m of movements) balance.set(m.articleId, (balance.get(m.articleId) ?? 0) + m.quantityMilli);
  return balance;
}

/**
 * Was beim Wiederöffnen (und beim Stornieren eines wieder geöffneten Auftrags) zu buchen ist: je Artikel das Gegenteil der Bilanz der bisherigen Bewegungen zu diesem Auftrag – in **beide**
 * Richtungen (ein Abgang wird zurückgebucht, ein Zugang durch eine negative Menge/Gutschriftsposition wieder abgezogen). Bilanz 0 ergibt nichts: Das Wiederöffnen stellt immer genau den
 * Zustand vor dem Abschluss her und ist bei mehrfachem Abschließen und Öffnen nie doppelt.
 */
export function reversalsFor(movements: ReadonlyArray<{ articleId: string; quantityMilli: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [articleId, balance] of orderBalance(movements)) if (balance !== 0) out.set(articleId, -balance);
  return out;
}

/**
 * Was beim Abschluss zu buchen ist: Ziel ist, dass die Bilanz des Auftrags je Artikel genau dem Verbrauch der Positionen (`consumed`, Abgang = −Menge) entspricht – gebucht wird die **Differenz**
 * zu dem, was schon gebucht ist. Normalfall (nichts gebucht): der Verbrauch. Wurde zwischenzeitlich nicht zurückgebucht (Teile & Lager war beim Wiederöffnen ausgeschaltet) oder haben sich
 * die Positionen geändert, bucht der Abschluss nur den Unterschied – nie doppelt. Artikel, die nicht mehr in den Positionen stehen, aber noch gebucht sind, werden zurückgebucht.
 */
export function closingDeltas(consumed: ReadonlyMap<string, number>, movements: ReadonlyArray<{ articleId: string; quantityMilli: number }>): Map<string, number> {
  const balance = orderBalance(movements);
  const out = new Map<string, number>();
  for (const articleId of new Set([...consumed.keys(), ...balance.keys()])) {
    const delta = -(consumed.get(articleId) ?? 0) - (balance.get(articleId) ?? 0);
    if (delta !== 0) out.set(articleId, delta);
  }
  return out;
}

/** Artikel, deren Bestand für die Summe aller Positionen nicht reicht (derselbe Artikel in mehreren Positionen zählt zusammen; Gutschriften mit negativer Menge nie). */
export function shortages(lines: ReadonlyArray<{ refId: string; quantityMilli: number }>, stock: ReadonlyMap<string, number>): Set<string> {
  const out = new Set<string>();
  for (const [articleId, needed] of sumByArticle(lines)) {
    const have = stock.get(articleId);
    if (have !== undefined && needed > 0 && have < needed) out.add(articleId);
  }
  return out;
}

/** Bestand in der Einheit des Artikels für die Anzeige (Tausendstel → Zahl). */
export const fromMilli = (milli: number): number => milli / 1000;
