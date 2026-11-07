import { OperationError } from "@/server/operations/errors";
import type { OperationHookDef } from "@/server/operations/hooks";
import type { OrderChange } from "@/modules/workshop/orders/public";
import { ARTICLE_REF } from "./constants";
import { bookableLines, reversalsFor, sumByArticle } from "./domain";
import { bookMovement } from "./stock";

/**
 * Teile & Lager als Abonnent der Aufträge (transaktionale Hooks, README „Aufträge und Lager“). Die Aufträge kennen diese Hooks nicht; sie laufen **in der Transaktion** der Auftragsoperation:
 * wirft einer, bleibt der Auftrag offen und nichts ist gebucht.
 *
 *  - `orders.close`: je Artikel der Positionen (Art „Teil“ mit Artikelverweis) wird die Menge abgebucht. Negativer Bestand ist erlaubt (Warnung in Auftrag, Liste und Übersicht, kein Fehler).
 *  - `orders.reopen`: bucht zurück, was für diesen Auftrag noch abgebucht ist (Saldo der Bewegungen) – bei mehrfachem Abschließen und Wiederöffnen also nie doppelt.
 *  - `orders.saveItems`: prüft, dass ein Verweis auf einen Artikel einen Artikel meint (sonst bliebe ein Tippfehler im Verweis für immer ohne Wirkung).
 * Eine **Stornorechnung** bucht den Bestand nicht zurück (bewusst manuelle Korrektur, die Hilfe sagt das).
 */
const closeHook: OperationHookDef = {
  operation: "orders.close",
  feature: "workshop.parts",
  run: async ({ tx, result, principal }) => {
    const order = result as OrderChange;
    const sums = sumByArticle(bookableLines(order.items));
    for (const [articleId, milli] of sums) {
      await bookMovement(tx, { articleId, kind: "order", delta: -milli, byName: principal.user.name.slice(0, 80), orderId: order.id, orderNumber: order.number });
    }
  },
};

const reopenHook: OperationHookDef = {
  operation: "orders.reopen",
  feature: "workshop.parts",
  run: async ({ tx, result, principal }) => {
    const order = result as OrderChange;
    const movements = await tx.stockMovement.findMany({ where: { orderId: order.id, kind: { in: ["order", "reversal"] } }, select: { articleId: true, quantityMilli: true } });
    for (const [articleId, milli] of reversalsFor(movements)) {
      await bookMovement(tx, { articleId, kind: "reversal", delta: milli, byName: principal.user.name.slice(0, 80), orderId: order.id, orderNumber: order.number });
    }
  },
};

const validateRefs: OperationHookDef = {
  operation: "orders.saveItems",
  feature: "workshop.parts",
  run: async ({ tx, input }) => {
    const items = (input as { items: Array<{ refType?: string; refId?: string }> }).items;
    const ids = [...new Set(items.filter((item) => item.refType === ARTICLE_REF && item.refId).map((item) => item.refId!))];
    if (ids.length === 0) return;
    const found = await tx.article.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const known = new Set(found.map((a) => a.id));
    items.forEach((item, i) => {
      if (item.refType === ARTICLE_REF && item.refId && !known.has(item.refId)) throw articleError(i);
    });
  },
};

const articleError = (index: number) => new OperationError({ code: "invalid", fields: { [`items.${index}.refId`]: { key: "parts.errors.articleUnknown" } } });

export const hooks: OperationHookDef[] = [closeHook, reopenHook, validateRefs];
