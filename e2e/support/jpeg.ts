import type { Page } from "@playwright/test";

/** Ein Foto, das ein Handy so ablegen würde: gültiges JPEG mit Exif-Block (Kamerahersteller als Klartext) – damit lässt sich prüfen, dass nichts davon die Anwendung verlässt. */
export const EXIF_MARKER = "E2E-GEHEIME-KAMERA";

/** JPEG aus dem Browser (Canvas) – ein echter Kodierer, Größe in Bildpunkten. */
export async function browserJpeg(page: Page, width = 640, height = 480, label = "Foto"): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height, label }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#2459c9");
      gradient.addColorStop(1, "#e8a33d");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#fff";
      context.font = "32px sans-serif";
      context.fillText(label, 24, 56);
      return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
    },
    { width, height, label },
  );
  return Buffer.from(base64, "base64");
}

/** Fügt hinter SOI einen Exif-Block (APP1) mit der Kennung `EXIF_MARKER` ein. */
export function withExif(jpeg: Buffer): Buffer {
  const text = Buffer.from(`${EXIF_MARKER}\0`, "latin1");
  const ifd = Buffer.alloc(2 + 12 + 4);
  ifd.writeUInt16LE(1, 0); // ein Eintrag
  ifd.writeUInt16LE(0x010f, 2); // Make
  ifd.writeUInt16LE(2, 4); // ASCII
  ifd.writeUInt32LE(text.length, 6);
  ifd.writeUInt32LE(8 + ifd.length, 10); // Offset des Textes hinter dem IFD
  const tiff = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]), ifd, text]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), segment, payload, jpeg.subarray(2)]);
}

export const hasExif = (bytes: Buffer) => bytes.includes(Buffer.from("Exif\0\0", "latin1")) || bytes.includes(Buffer.from(EXIF_MARKER, "latin1"));
