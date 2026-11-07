import qrcode from "qrcode-generator";

/**
 * QR-Code als Matrix (ohne externen Dienst, ohne Bild): `rows[y][x] === "1"` ist ein dunkles Modul. Der Browser zeichnet daraus ein SVG. Fehlerkorrektur „M“,
 * die kleinste Version, die den Text fasst. Die Bibliothek `qrcode-generator` (MIT, ohne Abhängigkeiten) ist die einzige für QR-Codes.
 */
export type QrMatrix = { size: number; rows: string[] };

export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = "";
    for (let x = 0; x < size; x++) row += qr.isDark(y, x) ? "1" : "0";
    rows.push(row);
  }
  return { size, rows };
}
