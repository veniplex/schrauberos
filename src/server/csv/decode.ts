import { CsvError } from "./reader";

export type CsvEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "windows-1252";

/**
 * Bytes → Text. Erkannt wird in dieser Reihenfolge: Byte-Order-Mark (UTF-8, UTF-16 LE/BE), gültiges UTF-8 (streng – ein einziges ungültiges Byte genügt für den Rückfall),
 * sonst Windows-1252 (der Standard von Excel in Deutschland ohne „UTF-8“-Auswahl). Enthält eine Datei ohne UTF-16-Kennung NUL-Bytes, ist sie keine Textdatei
 * (Excel-Arbeitsmappe, Bild, Archiv …): `CsvError("binary")`. Die Byte-Order-Mark gehört nie zum Inhalt der ersten Spalte.
 */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3)), encoding: "utf-8-bom" };
    } catch {
      // Kennung vorhanden, Inhalt aber kein UTF-8: wie ohne Kennung weiter
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  // NUL-Bytes: nur im Anfang prüfen reicht nicht (eine Datei kann erst spät Binäres enthalten), aber ein NUL irgendwo macht sie für CSV unbrauchbar
  if (bytes.includes(0)) throw new CsvError("binary", 1);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}
