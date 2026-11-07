import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Anonymisierung eines Kunden (`customers.anonymize`, P4b-5): Kundenwunsch und Befunde (Freitext) seiner Aufträge entfallen, die Namen der freigebenden Personen im Freigabe-Protokoll
 * und im Verlauf (samt getipptem Namen) werden unkenntlich. Nummer, Positionen (`description`), Begründung der Mehrarbeit (`reason`), Beträge und Zeitpunkte bleiben bewusst: Sie sind der
 * Beleg des Vorgangs und fallen unter die Aufbewahrungsfristen (Entscheid 7, Steuerberater – die Fristen für Aufträge sind noch offen). Die Unterschrift als Bilddatei bleibt liegen: Eine
 * Datei lässt sich nicht in der Transaktion zurückholen, und das Protokoll soll auch danach den Vorgang belegen (die Auskunft nennt sie). Der Audit-Eintrag der Freigabe enthält nur die
 * Auftragsnummer, nie den Namen.
 */
export const hooks: OperationHookDef[] = [
  {
    operation: "customers.anonymize",
    feature: "workshop.orders",
    always: true,
    run: async ({ tx, input }) => {
      const { id } = input as { id: string };
      const mine = { order: { customerId: id } };
      await tx.order.updateMany({ where: { customerId: id }, data: { request: null } });
      await tx.orderFinding.updateMany({ where: mine, data: { text: "(anonymisiert)" } });
      await tx.orderApproval.updateMany({ where: mine, data: { approverName: "(anonymisiert)", signedName: null } });
      await tx.orderEvent.updateMany({ where: { ...mine, kind: "approval" }, data: { note: null } });
    },
  },
];
