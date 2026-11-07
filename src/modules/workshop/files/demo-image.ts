import { deflateSync } from "node:zlib";
import { crc32 } from "@/lib/png";

/** Ein kleines, gültiges PNG in einer Farbe mit einem hellen Streifen (Demo-Fotos, ohne Bildbibliothek). */
export function demoPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(name, 4, "latin1");
    const body = Buffer.concat([head, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body, 4, body.length), 0);
    return Buffer.concat([body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) {
    const base = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const stripe = Math.abs(x - y * (width / height)) < width / 10;
      rows[base + 1 + x * 3] = stripe ? 245 : r;
      rows[base + 2 + x * 3] = stripe ? 245 : g;
      rows[base + 3 + x * 3] = stripe ? 245 : b;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** Ein winziges, gültiges PDF mit einer Zeile Text (Demo-Dokument). */
export function demoPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, " ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 14 Tf 20 60 Td (${safe}) Tj ET`.length} >>\nstream\nBT /F1 14 Tf 20 60 Td (${safe}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
