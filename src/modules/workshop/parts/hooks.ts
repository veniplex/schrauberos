import { OperationError } from "@/server/operations/errors";
import type { OperationHookDef } from "@/server/operations/hooks";
import type { OrderChange } from "@/modules/workshop/orders/public";
import { ARTICLE_REF } from "./constants";
import { bookableLines, closingDeltas, reversalsFor, sumByArticle } from "./domain";
import { bookMovement } from "./stock";

/**
 * Teile & Lager als Abonnent der Aufträge (transaktionale Hooks, README „Aufträge und Lager“). Die Aufträge kennen diese Hooks nicht; sie laufen **in der Transaktion** der Auftragsoperation:
 * wirft einer, bleibt der Auftrag offen und nichts ist gebucht.
 *
 * Maßgeblich ist immer die **Bilanz der Bewegungen dieses Auftrags** je Artikel (Abgänge negativ, Rückbuchungen positiv), nicht der Funktionsstatus oder die Zahl der Abschlüsse:
 *  - `orders.close`: bucht je Artikel die Differenz zwischen dem Verbrauch der Positionen (Art „Teil“ mit Artikelverweis) und der Bilanz – normalerweise den Verbrauch, nach einem Wiederöffnen
 *    ohne Rückbuchung (Teile & Lager war ausgeschaltet) nur den Unterschied. Negativer Bestand ist erlaubt (Warnung in Auftrag, Liste und Übersicht, kein Fehler).
 *  - `orders.reopen` und das Stornieren (`orders.setStatus` → Storniert): stellen die Bilanz auf 0 zurück, in beide Richtungen (auch eine negative Menge/Gutschrift) – nie doppelt.
 *  - `orders.saveItems`: prüft, dass ein Verweis auf einen Artikel einen Artikel meint (sonst bliebe ein Tippfehler im Verweis für immer ohne Wirkung).
 * Eine **Stornorechnung** bucht den Bestand nicht zurück (bewusst manuelle Korrektur, die Hilfe sagt das).
 */
const movementsOf = (tx: Parameters<OperationHookDef["run"]>[0]["tx"], orderId: string) =>
  tx.stockMovement.findMany({ where: { orderId, kind: { in: ["order", "reversal"] } }, select: { articleId: true, quantityMilli: true } });

const closeHook: OperationHookDef = {
  operation: "orders.close",
  feature: "workshop.parts",
  run: async ({ tx, result, principal }) => {
    const order = result as OrderChange;
    const deltas = closingDeltas(sumByArticle(bookableLines(order.items)), await movementsOf(tx, order.id));
    for (const [articleId, delta] of deltas) {
      await bookMovement(tx, { articleId, kind: delta < 0 ? "order" : "reversal", delta, byName: principal.user.name.slice(0, 80), orderId: order.id, orderNumber: order.number });
    }
  },
};

const reverseAll: OperationHookDef["run"] = async ({ tx, result, principal }) => {
  const order = result as OrderChange;
  for (const [articleId, delta] of reversalsFor(await movementsOf(tx, order.id))) {
    await bookMovement(tx, { articleId, kind: "reversal", delta, byName: principal.user.name.slice(0, 80), orderId: order.id, orderNumber: order.number });
  }
};

const reopenHook: OperationHookDef = { operation: "orders.reopen", feature: "workshop.parts", run: reverseAll };

/** Ein Auftrag, der nach dem Wiederöffnen (bei ausgeschalteter Funktion ohne Rückbuchung) storniert wird, gibt seine Buchungen frei; ohne Buchungen geschieht nichts. */
const cancelHook: OperationHookDef = {
  operation: "orders.setStatus",
  feature: "workshop.parts",
  run: async (ctx) => {
    if ((ctx.result as OrderChange).status === "cancelled") await reverseAll(ctx);
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

export const hooks: OperationHookDef[] = [closeHook, reopenHook, cancelHook, validateRefs];
