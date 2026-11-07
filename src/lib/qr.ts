import qrcode from "qrcode-generator";

/**
 * QR-Code als Matrix (ohne externen Dienst, ohne Bild): `rows[y][x] === "1"` ist ein dunkles Modul. Der Browser zeichnet daraus ein SVG. Fehlerkorrektur „M“,
 * die kleinste Version, die den Text fasst. Die Bibliothek `qrcode-generator` (MIT, ohne Abhängigkeiten) ist die einzige für QR-Codes.
 *
 * Der Text wird als **UTF-8** kodiert (die Bibliothek nimmt sonst je Zeichen nur das untere Byte: „€“ würde zu „¬“, Umlaute im Girocode wären falsch). Ist er länger, als in die größte
 * Version (40-M) passt, gibt es einen {@link QrTooLongError} – nie die Zeichenkette, die die Bibliothek selbst wirft.
 */
export type QrMatrix = { size: number; rows: string[] };

/** Mehr Bytes, als der größte QR-Code (Version 40, Fehlerkorrektur M, Byte-Modus) fasst. */
export const QR_MAX_BYTES = 2331;

export class QrTooLongError extends Error {
  constructor() {
    super("QR: Inhalt zu lang");
    this.name = "QrTooLongError";
  }
}

export function qrMatrix(text: string): QrMatrix {
  if (new TextEncoder().encode(text).length > QR_MAX_BYTES) throw new QrTooLongError();
  // die Bibliothek liest die Kodierung beim Hinzufügen der Daten aus dieser Stelle
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  try {
    qr.make();
  } catch (error) {
    // die Bibliothek wirft Zeichenketten statt Fehler
    throw error instanceof Error ? error : new QrTooLongError();
  }
  const size = qr.getModuleCount();
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = "";
    for (let x = 0; x < size; x++) row += qr.isDark(y, x) ? "1" : "0";
    rows.push(row);
  }
  return { size, rows };
}
