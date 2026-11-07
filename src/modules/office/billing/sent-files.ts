import "server-only";
import { db } from "@/server/db";
import { removeFile } from "@/server/files";

/**
 * Aufräumlauf der versendeten Anhänge (`rechnungen/versand/…`, Tabelle `InvoiceSentFile`): Ist `purgeAfter` erreicht, wird die Datei vom Datenträger gelöst und die Zeile entfernt. Das setzen
 * der Versand (Angebote und Auftragsbestätigungen: 30 Tage nach dem Versand) und die Anonymisierung eines Kunden (sofort) – Rechnungen behalten ihre Kopie „wie versendet“ sonst. Das löst nur den Verweis
 * unter `/data/files`: Backups halten ihre Dateien per Hardlink und behalten sie bis zu ihrer eigenen Aufbewahrung.
 *
 * Wiederholbar: erst die Datei lösen (fehlt sie schon, ist das in Ordnung), dann die Zeile löschen; ein Abbruch dazwischen holt der nächste Lauf nach. In Teilen, damit ein Lauf kurz bleibt.
 */
const BATCH = 200;

export async function purgeSentFiles(now: Date = new Date()): Promise<number> {
  let purged = 0;
  for (;;) {
    const rows = await db.invoiceSentFile.findMany({ where: { purgeAfter: { not: null, lte: now } }, orderBy: { purgeAfter: "asc" }, take: BATCH, select: { id: true, path: true } });
    if (rows.length === 0) return purged;
    for (const row of rows) {
      await removeFile(row.path);
      await db.invoiceSentFile.delete({ where: { id: row.id } });
      purged++;
    }
    if (rows.length < BATCH) return purged;
  }
}
