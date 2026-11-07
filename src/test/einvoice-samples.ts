import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Beispiele für die Prüfung gegen den KoSIT-Prüfer (Pipeline-Job "xrechnung", `scripts/validate-xrechnung.sh`): Tests, die E-Rechnungs-XML erzeugen (F3), rufen dies mit dem fertigen
 * Dokument auf. Ist `EINVOICE_SAMPLES_DIR` nicht gesetzt (normaler Testlauf), geschieht nichts; sonst wird die Datei dort abgelegt. Tests, die Beispiele schreiben, heißen
 * `*.einvoice.test.ts` (nur diese führt der Job aus). Nur Tests – nicht im Produktionscode verwenden.
 */
export function writeEinvoiceSample(name: string, xml: string): string | null {
  const dir = process.env.EINVOICE_SAMPLES_DIR;
  if (!dir) return null;
  if (!/^[a-z0-9][a-z0-9._-]*\.xml$/i.test(name)) throw new Error(`Ungültiger Beispielname: ${name}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, xml, "utf8");
  return file;
}
