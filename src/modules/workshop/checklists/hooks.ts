import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Anonymisierung eines Kunden (`customers.anonymize`, P4b-5), in derselben Transaktion: Kundenname und getippter Name der Unterschrift, Anmerkung und die Freitexte der Punkte (z. B. „Auffälligkeiten“) der Checklisten
 * an seinen Fahrzeugen und Aufträgen werden gelöscht. **Die Unterschrift als Bilddatei bleibt liegen** (eine Datei lässt sich nicht in der Transaktion zurückholen, und das Protokoll soll den Vorgang weiter
 * belegen); Vorlage, Messwerte und Haken bleiben. Die Auskunft nennt die Unterschrift. Das gilt auch für Dateien, die am Fahrzeug/Auftrag hängen (Funktion Dokumente & Fotos).
 */
export const hooks: OperationHookDef[] = [
  {
    operation: "customers.anonymize",
    feature: "workshop.checklists",
    run: async ({ tx, input }) => {
      const { id } = input as { id: string };
      const mine = { OR: [{ vehicle: { is: { customerId: id } } }, { order: { is: { customerId: id } } }] };
      await tx.checklist.updateMany({ where: mine, data: { customerName: null, signedName: null, note: null } });
      await tx.checklistItem.updateMany({ where: { type: "text", checklist: { is: mine } }, data: { textValue: null } });
    },
  },
];
