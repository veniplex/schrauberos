import "server-only";
import { db } from "@/server/db";
import { moveFile, removeFile } from "@/server/files";
import { invoiceFileLocation } from "./domain";

/** Hält den Dateinamen aktuell, wenn sich Datum, Partner, Nummer oder Richtung der Rechnung geändert haben. */
export async function syncInvoiceFile(invoiceId: string): Promise<void> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { file: true } });
  if (!inv?.file) return;
  const { dir, name } = invoiceFileLocation(inv, inv.file.mime);
  const target = `${dir}/${name}`;
  if (inv.file.path === target || inv.file.path.startsWith(target.replace(/\.[a-z]+$/, "-"))) return; // schon richtig (ggf. mit Zähler)
  const moved = await moveFile(inv.file.path, dir, name);
  if (moved !== inv.file.path) await db.invoiceFile.update({ where: { invoiceId }, data: { path: moved } });
}

/** Löscht die Beleg-Datei einer Rechnung (nach dem Löschen der Zeile aufrufen; ein fehlender Eintrag ist kein Fehler). */
export const removeInvoiceFile = (path: string) => removeFile(path);
