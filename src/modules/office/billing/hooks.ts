import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Anonymisierung eines Kunden (`customers.anonymize`, P4b-5), in derselben Transaktion:
 *  - **Entwürfe** des Kunden werden gelöscht (nie ausgestellt, keine Aufbewahrungsfrist – nur Arbeitsstand mit Anschrift und Namen),
 *  - bei ausgestellten und festgeschriebenen Belegen entfallen die **E-Mail-Adresse** des Empfängers (Beleg und Schnappschuss) und die Käuferreferenz-unabhängigen Kontaktdaten, die der Beleg nicht braucht;
 *    **Name und Anschrift bleiben** (Pflichtangabe der Rechnung, Aufbewahrungsfrist – die Anonymisierung ist ohnehin erst nach Ablauf der Fristen freigegeben, `anonymizeBlock`),
 *  - das **Sendeprotokoll** (E-Mails zu Belegen des Kunden): Empfängeradresse, Betreff und Fehlercodes-freie Angaben werden unkenntlich gemacht, Inhalt und Anhänge entfallen; Zeitpunkt und Status bleiben.
 * Die Anhänge der versendeten Mails (PDF, XRechnung) liegen als Dateien im Dateispeicher; eine Datei lässt sich nicht in der Transaktion löschen. Der Hook setzt sie deshalb auf „jetzt fällig“
 *    (`InvoiceSentFile.purgeAfter`), der Aufräumlauf `billing.sent-files` löst sie vom Datenträger (Backups behalten ihre Hardlinks bis zur eigenen Aufbewahrung). Dasselbe gilt für die **Originale** festgeschriebener
 *    Rechnungen (`InvoiceOriginal.purgeAfter`, Aufräumlauf `billing.originals`).
 */
export const hooks: OperationHookDef[] = [
  {
    // Storno-Gegenbeleg eines Beleges der Rechnungserstellung: bekommt wie jede festgeschriebene Rechnung sein eigenes Original (PDF, ggf. XRechnung), in derselben Transaktion – scheitert die Erzeugung, scheitert das Storno.
    // `always`: auch bei ausgeschalteter Rechnungserstellung kann das Archiv einen Beleg stornieren (Daten und Rechnungsnummern bleiben), das Original darf dann nicht fehlen.
    operation: "invoices.cancel",
    feature: "office.billing",
    always: true,
    run: async ({ tx, result, onRollback }) => {
      const { counterId, fromBilling } = result as { counterId: string; fromBilling: boolean };
      if (!fromBilling) return;
      const { createOriginals } = await import("./originals");
      await createOriginals(tx, counterId, onRollback);
    },
  },
  {
    operation: "customers.anonymize",
    feature: "office.billing",
    always: true,
    run: async ({ tx, input }) => {
      const { id } = input as { id: string };
      // Entwürfe (nie festgeschrieben) gehen ganz: Positionen und Anrechnungen folgen per Cascade
      await tx.invoice.deleteMany({ where: { customerId: id, source: "billing", finalizedAt: null } });
      const docs = await tx.invoice.findMany({ where: { customerId: id, source: "billing" }, select: { id: true } });
      const ids = docs.map((d) => d.id);
      if (ids.length === 0) return;
      await tx.invoice.updateMany({ where: { id: { in: ids } }, data: { buyerEmail: null } });
      await tx.invoiceSnapshot.updateMany({ where: { invoiceId: { in: ids } }, data: { rEmail: null } });
      await tx.invoiceSentFile.updateMany({ where: { invoiceId: { in: ids } }, data: { purgeAfter: new Date() } });
      // die Originale (PDF, XRechnung) tragen Name und Anschrift: sie gehen mit – die Anonymisierung ist erst nach Ablauf der Aufbewahrungsfristen freigegeben (`anonymizeBlock`)
      await tx.invoiceOriginal.updateMany({ where: { invoiceId: { in: ids } }, data: { purgeAfter: new Date() } });
      await tx.mailMessage.updateMany({
        where: { purpose: "billing", entityId: { in: ids } },
        data: { toAddresses: "(anonymisiert)", deliveredTo: null, subject: "(anonymisiert)", body: null, attachments: null },
      });
    },
  },
];
