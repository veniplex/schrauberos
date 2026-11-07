import type { PrismaClient } from "@/generated/prisma/client";
import { searchKey } from "@/lib/search-key";
import { addDays } from "@/lib/zone";
import type { SeedDef } from "@/modules/types";
import { ARTICLE_REF } from "./constants";

type Demo = { number: string; name: string; unit: string; supplier: string; purchase: number; sale: number; taxBp?: number; min: number; receipt: number };

const ARTICLES: Demo[] = [
  { number: "OEL-5W30-1L", name: "Motoröl 5W-30 (1 l)", unit: "l", supplier: "Autoteile Nord", purchase: 780, sale: 1450, min: 20, receipt: 48 },
  { number: "FILT-OEL-01", name: "Ölfilter Standard", unit: "Stk", supplier: "Autoteile Nord", purchase: 420, sale: 890, min: 5, receipt: 12 },
  { number: "BEL-VA-01", name: "Bremsbeläge Vorderachse", unit: "Satz", supplier: "Bremsen Schulz", purchase: 2890, sale: 5490, min: 2, receipt: 1 },
  { number: "SCH-VA-01", name: "Bremsscheiben Vorderachse (Paar)", unit: "Paar", supplier: "Bremsen Schulz", purchase: 5900, sale: 10900, min: 1, receipt: 3 },
  { number: "KLIMA-KOND", name: "Kondensator Klimaanlage", unit: "Stk", supplier: "Klima Service Berlin", purchase: 11200, sale: 18900, min: 0, receipt: 2 },
  { number: "WISCH-60", name: "Wischerblatt 60 cm", unit: "Stk", supplier: "Autoteile Nord", purchase: 380, sale: 790, min: 4, receipt: 3 },
  { number: "WUCHT-5G", name: "Wuchtgewicht 5 g", unit: "Stk", supplier: "Reifen Meier", purchase: 8, sale: 25, min: 100, receipt: 400 },
];

/**
 * Demo-Artikel mit Wareneingang. Dazu an den Demo-Aufträgen (gefunden über die Positionsbezeichnung, fehlt der Auftrag, entfällt der Verweis): ein offener Auftrag mit einem Teil, das
 * nicht auf Lager ist (Warnung), ein abholbereiter mit Verweis (noch nicht gebucht) und ein abgeschlossener, dessen Verbrauch schon gebucht ist.
 */
async function demo(db: PrismaClient) {
  if ((await db.article.count()) > 0) return;
  console.log("Demo-Daten (Teile & Lager) werden angelegt …");

  const ids = new Map<string, string>();
  for (const [index, a] of ARTICLES.entries()) {
    const article = await db.article.create({
      data: {
        number: a.number,
        name: a.name,
        searchKey: searchKey(a.number, a.name, a.supplier),
        unit: a.unit,
        supplier: a.supplier,
        purchaseCents: a.purchase,
        saleCents: a.sale,
        taxBp: a.taxBp ?? 1900,
        minStockMilli: a.min * 1000,
        stockMilli: a.receipt * 1000,
      },
    });
    ids.set(a.number, article.id);
    await db.stockMovement.create({
      data: { articleId: article.id, kind: "receipt", quantityMilli: a.receipt * 1000, stockAfterMilli: a.receipt * 1000, reference: `LS-2026-${String(index + 101)}`, note: "Erstbestand", byName: "Demo", createdAt: addDays(new Date(), -30) },
    });
  }

  /** Hängt einen Artikel an den (ersten) Auftrag im Status: eine vorhandene Position `convert` bekommt den Verweis, sonst entsteht eine neue Teile-Position. */
  const attach = async (status: string, number: string, quantity: number, book: boolean, convert?: string) => {
    const articleId = ids.get(number);
    const order = await db.order.findFirst({ where: { status }, orderBy: { acceptedAt: "asc" }, select: { id: true, number: true } });
    if (!articleId || !order) return;
    const existing = convert ? await db.orderItem.findFirst({ where: { orderId: order.id, description: convert }, select: { id: true } }) : null;
    if (existing) await db.orderItem.update({ where: { id: existing.id }, data: { kind: "part", refType: ARTICLE_REF, refId: articleId } });
    else {
      const count = await db.orderItem.count({ where: { orderId: order.id } });
      const article = await db.article.findUniqueOrThrow({ where: { id: articleId } });
      await db.orderItem.create({
        data: { orderId: order.id, position: count, kind: "part", description: article.name, unit: article.unit, quantityMilli: quantity * 1000, unitCents: article.saleCents ?? 0, taxBp: article.taxBp, refType: ARTICLE_REF, refId: articleId },
      });
    }
    if (!book) return;
    const article = await db.article.update({ where: { id: articleId }, data: { stockMilli: { decrement: quantity * 1000 } } });
    await db.stockMovement.create({
      data: { articleId, kind: "order", quantityMilli: -quantity * 1000, stockAfterMilli: article.stockMilli, orderId: order.id, orderNumber: order.number, byName: "Demo", createdAt: addDays(new Date(), -11) },
    });
  };

  // offen: Bremsbeläge (Bestand 1, gebraucht 2 → Warnung „Bestand reicht nicht“), abholbereit: Kondensator (Verweis, noch ungebucht), abgeschlossen: Wuchtgewichte (gebucht)
  await attach("in_progress", "BEL-VA-01", 2, false);
  await attach("ready", "KLIMA-KOND", 1, false, "Kondensator Klimaanlage");
  await attach("picked_up", "WUCHT-5G", 12, true);
}

export const seeds: SeedDef[] = [{ id: "parts", feature: "workshop.parts", order: 62, demo }];
