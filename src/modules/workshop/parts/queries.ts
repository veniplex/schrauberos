import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Viewer } from "@/modules/types";
import { db } from "@/server/db";
import { keyContains } from "@/server/search";
import { ARTICLE_REF } from "./constants";
import { stockState } from "./domain";

/**
 * Lesezugriffe von Teile & Lager (README, „Datenzugriff“). **Preise** (Einkauf, Verkauf) liest nur, wer `parts.prices` hat: ohne das Recht kommen die Spalten gar nicht erst aus der Datenbank.
 * Das Leserecht der Funktion ist `parts.view`; die Abfragen prüfen es zusätzlich.
 */

const BASE = { id: true, number: true, name: true, unit: true, supplier: true, taxBp: true, stockMilli: true, minStockMilli: true, notes: true, archivedAt: true, updatedAt: true } as const;
const PRICES = { purchaseCents: true, saleCents: true } as const;

const requireView = (viewer: Viewer) => {
  if (!viewer.can("parts.view")) throw new Error("parts.view fehlt");
};

export type ArticleFilters = { q: string; /** `low`: unter oder auf dem Mindestbestand oder negativ */ stock?: "low" | "negative"; archived?: "active" | "archived" | "all" };

/** Suche über die normalisierte Spalte (Nummer, Bezeichnung, Lieferant: Wörter in beliebiger Reihenfolge). */
export function articleWhere(filters: ArticleFilters): Prisma.ArticleWhereInput {
  const term = filters.q.trim();
  const archived = filters.archived ?? "active";
  return {
    ...(archived === "active" ? { archivedAt: null } : archived === "archived" ? { archivedAt: { not: null } } : {}),
    ...(term ? keyContains("searchKey", term) : {}),
    ...(filters.stock === "negative" ? { stockMilli: { lt: 0 } } : {}),
  };
}

type ArticleRowBase = Prisma.ArticleGetPayload<{ select: typeof BASE }>;
export type ArticleRow = ArticleRowBase & Partial<{ purchaseCents: number | null; saleCents: number | null }>;

/** Liste der Artikel; „unter Mindestbestand“ ist ein Vergleich zweier Spalten und wird deshalb nach dem Lesen gefiltert (der Bestand ist klein, die Seite begrenzt die Anzeige). */
export async function listArticles(viewer: Viewer, filters: ArticleFilters, page: { skip: number; take: number; orderBy: Prisma.ArticleOrderByWithRelationInput[] }): Promise<{ rows: ArticleRow[]; total: number }> {
  requireView(viewer);
  const where = articleWhere(filters);
  const select = viewer.can("parts.prices") ? { ...BASE, ...PRICES } : BASE;
  if (filters.stock === "low") {
    const all = (await db.article.findMany({ where, select, orderBy: page.orderBy })) as ArticleRow[];
    const low = all.filter((a) => stockState(a.stockMilli, a.minStockMilli) !== "ok");
    return { rows: low.slice(page.skip, page.skip + page.take), total: low.length };
  }
  const [rows, total] = await Promise.all([db.article.findMany({ where, select, orderBy: page.orderBy, skip: page.skip, take: page.take }), db.article.count({ where })]);
  return { rows: rows as ArticleRow[], total };
}

export async function getArticle(viewer: Viewer, id: string): Promise<ArticleRow | null> {
  requireView(viewer);
  return (await db.article.findUnique({ where: { id }, select: viewer.can("parts.prices") ? { ...BASE, ...PRICES } : BASE })) as ArticleRow | null;
}

export async function listMovements(viewer: Viewer, articleId: string, take = 50) {
  requireView(viewer);
  return db.stockMovement.findMany({
    where: { articleId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, kind: true, quantityMilli: true, stockAfterMilli: true, orderId: true, orderNumber: true, reference: true, note: true, byName: true, createdAt: true },
  });
}

/** Zähler für die Statusleiste der Liste und die Übersicht. */
export async function stockCounts() {
  const articles = await db.article.findMany({ where: { archivedAt: null }, select: { stockMilli: true, minStockMilli: true } });
  let low = 0;
  let negative = 0;
  for (const a of articles) {
    const state = stockState(a.stockMilli, a.minStockMilli);
    if (state === "negative") negative += 1;
    if (state !== "ok") low += 1;
  }
  return { all: articles.length, low, negative };
}

/** Die Artikel unter Mindestbestand (oder negativ), knappste zuerst – Grundlage des Übersichtsbausteins. */
export async function lowStockArticles(limit = 6) {
  const articles = await db.article.findMany({ where: { archivedAt: null }, select: { id: true, number: true, name: true, unit: true, stockMilli: true, minStockMilli: true } });
  return articles
    .filter((a) => stockState(a.stockMilli, a.minStockMilli) !== "ok")
    .sort((a, b) => a.stockMilli - a.minStockMilli - (b.stockMilli - b.minStockMilli))
    .slice(0, limit);
}

/** Auswahl für den Positionen-Editor (nur aktive Artikel); Verkaufspreis und Steuersatz nur mit `parts.prices`. */
export async function pickerArticles(viewer: Viewer, q: string, take = 8) {
  requireView(viewer);
  const prices = viewer.can("parts.prices");
  const rows = await db.article.findMany({
    where: { archivedAt: null, ...(q.trim() ? keyContains("searchKey", q) : {}) },
    orderBy: { number: "asc" },
    take,
    select: { id: true, number: true, name: true, unit: true, taxBp: true, stockMilli: true, ...(prices ? { saleCents: true } : {}) },
  });
  return rows as Array<{ id: string; number: string; name: string; unit: string; taxBp: number; stockMilli: number; saleCents?: number | null }>;
}

/**
 * „Verbrauchte Teile“ eines Auftrags: seine Positionen mit Artikelverweis, den aktuellen Bestand und – was schon gebucht ist (Saldo der Bewegungen dieses Auftrags). Daraus entstehen
 * der Hinweis „Bestand reicht nicht“ vor dem Abschluss und „Bestand ist negativ“ danach.
 */
export async function consumedParts(orderId: string, lines: ReadonlyArray<{ id: string; description: string; unit: string; quantityMilli: number; refType: string | null; refId: string | null; kind: string }>) {
  const refs = lines.filter((l) => l.kind === "part" && l.refType === ARTICLE_REF && l.refId);
  if (refs.length === 0) return [];
  const ids = [...new Set(refs.map((l) => l.refId!))];
  const [articles, movements] = await Promise.all([
    db.article.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, name: true, unit: true, stockMilli: true } }),
    db.stockMovement.findMany({ where: { orderId, articleId: { in: ids }, kind: { in: ["order", "reversal"] } }, select: { articleId: true, quantityMilli: true } }),
  ]);
  const byId = new Map(articles.map((a) => [a.id, a]));
  const booked = new Map<string, number>();
  for (const m of movements) booked.set(m.articleId, (booked.get(m.articleId) ?? 0) + m.quantityMilli);
  return refs.map((line) => ({ line, article: byId.get(line.refId!) ?? null, bookedMilli: 0 - (booked.get(line.refId!) ?? 0) }));
}
