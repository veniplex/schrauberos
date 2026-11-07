import { failField } from "@/server/operations/errors";
import type { OperationHookDef } from "@/server/operations/hooks";
import { TIME_REF_TYPE } from "./constants";

/**
 * Zeiterfassung als Abonnent der Aufträge (transaktionale Hooks): `orders.saveItems` ersetzt immer **alle** Positionen eines Auftrags (der Editor schickt die ganze Liste). Der Hook läuft in derselben Transaktion und
 *  1. prüft jede Position mit `refType: "time"`: Sie muss auf einen **übernommenen, nicht stornierten Eintrag dieses Auftrags** zeigen (sonst bliebe ein Tippfehler im Verweis stumm, und über die API ließen sich beliebige
 *     Verweise setzen) – und jeder Eintrag höchstens einmal;
 *  2. gleicht die Markierung der Einträge ab: Eine Position, die entfallen ist, macht ihre Zeit wieder übernehmbar (`transferredAt`/`transferredItemId` zurückgesetzt) – sonst ginge die Arbeitszeit verloren: übernommen, aber nirgends
 *     abgerechnet und nicht mehr korrigierbar. Die Positionen bekommen beim Speichern neue Kennungen, deshalb wird `transferredItemId` bei den verbliebenen nachgeführt.
 * Einträge ohne Position (übernommen mit 0 abrechenbaren Minuten: `transferredItemId` leer) bleiben unberührt.
 */
const saveItemsHook: OperationHookDef = {
  operation: "orders.saveItems",
  feature: "office.time",
  always: true, // die Markierungen gehören der Zeiterfassung und müssen auch bei ausgeschalteter Funktion stimmen (Daten bleiben)
  run: async ({ tx, input }) => {
    const { id, items } = input as { id: string; items: Array<{ refType?: string; refId?: string }> };
    const refs = items.flatMap((item, index) => (item.refType === TIME_REF_TYPE ? [{ index, refId: item.refId ?? "" }] : []));
    if (refs.length > 0) {
      const found = await tx.timeEntry.findMany({ where: { id: { in: refs.map((r) => r.refId) }, orderId: id, voidedAt: null, transferredAt: { not: null } }, select: { id: true } });
      const known = new Set(found.map((e) => e.id));
      const seen = new Set<string>();
      for (const ref of refs) {
        if (!known.has(ref.refId) || seen.has(ref.refId)) failField(`items.${ref.index}.refId`, "validation.invalid");
        seen.add(ref.refId);
      }
    }
    const marked = await tx.timeEntry.findMany({ where: { orderId: id, transferredItemId: { not: null } }, select: { id: true, transferredItemId: true } });
    if (marked.length === 0) return;
    const current = new Map((await tx.orderItem.findMany({ where: { orderId: id, refType: TIME_REF_TYPE }, select: { id: true, refId: true } })).map((item) => [item.refId, item.id]));
    for (const entry of marked) {
      const itemId = current.get(entry.id);
      if (!itemId) await tx.timeEntry.update({ where: { id: entry.id }, data: { transferredAt: null, transferredItemId: null } });
      else if (itemId !== entry.transferredItemId) await tx.timeEntry.update({ where: { id: entry.id }, data: { transferredItemId: itemId } });
    }
  },
};

/**
 * Anonymisierung eines Kunden (`customers.anonymize`, P4b-5): Notiz und Tätigkeit (Freitext, nennen oft Kunde oder Fahrzeug) der Zeiten auf seinen Aufträgen entfallen, ebenso der frühere Stand davon im Korrekturverlauf.
 * Zeiten, Pausen, Begründungen und Personen (Arbeitszeitnachweis) bleiben. Läuft auch bei ausgeschalteter Funktion (`always`).
 */
const anonymizeHook: OperationHookDef = {
  operation: "customers.anonymize",
  feature: "office.time",
  always: true,
  run: async ({ tx, input }) => {
    const { id } = input as { id: string };
    const mine = { order: { is: { customerId: id } } };
    await tx.timeEntry.updateMany({ where: mine, data: { note: null, activity: null } });
    await tx.timeCorrection.updateMany({ where: { entry: { is: mine } }, data: { prevNote: null, prevActivity: null } });
  },
};

export const hooks: OperationHookDef[] = [saveItemsHook, anonymizeHook];
