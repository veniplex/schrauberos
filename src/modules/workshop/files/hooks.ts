import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Anonymisierung eines Kunden (`customers.anonymize`, P4b-5), in derselben Transaktion: Beschriftungen (Freitext) und Dateinamen (sie tragen oft Namen oder Nummern) der Dateien an seinen Fahrzeugen und
 * Aufträgen werden unkenntlich. **Die Dateien selbst bleiben liegen und unverändert** (Fahrzeug- und Auftragsdokumentation, Backups per Hardlink; eine Datei lässt sich nicht in der Transaktion zurückholen) –
 * Bilder und PDFs können dennoch Personen oder Dokumente zeigen: Wer das nicht will, entfernt sie vorher am Fahrzeug bzw. Auftrag. Die Hilfe sagt das.
 */
export const hooks: OperationHookDef[] = [
  {
    operation: "customers.anonymize",
    feature: "workshop.files",
    run: async ({ tx, input }) => {
      const { id } = input as { id: string };
      const mine = { OR: [{ vehicle: { is: { customerId: id } } }, { order: { is: { customerId: id } } }] };
      await tx.fileAttachment.updateMany({ where: mine, data: { caption: null } });
      const files = await tx.fileAttachment.findMany({ where: mine, select: { id: true, mime: true } });
      for (const file of files) await tx.fileAttachment.update({ where: { id: file.id }, data: { name: file.mime === "application/pdf" ? "dokument.pdf" : file.mime === "image/png" ? "foto.png" : "foto.jpg" } });
    },
  },
];
