import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Anonymisierung eines Kunden (`customers.anonymize`, P4b-5): Kundenwunsch und Befunde (Freitext) seiner Aufträge entfallen, die Namen der freigebenden Personen im Freigabe-Protokoll
 * und im Verlauf werden unkenntlich. Nummer, Positionen, Beträge und Zeitpunkte bleiben (Beleg- und Aufbewahrungsfristen). Die Unterschrift als Bilddatei bleibt liegen: Eine Datei
 * lässt sich nicht in der Transaktion zurückholen, und das Protokoll soll auch danach den Vorgang belegen.
 */
export const hooks: OperationHookDef[] = [
  {
    operation: "customers.anonymize",
    feature: "workshop.orders",
    run: async ({ tx, input }) => {
      const { id } = input as { id: string };
      const mine = { order: { customerId: id } };
      await tx.order.updateMany({ where: { customerId: id }, data: { request: null } });
      await tx.orderFinding.updateMany({ where: mine, data: { text: "(anonymisiert)" } });
      await tx.orderApproval.updateMany({ where: mine, data: { approverName: "(anonymisiert)" } });
      await tx.orderEvent.updateMany({ where: { ...mine, kind: "approval" }, data: { note: null } });
    },
  },
];
