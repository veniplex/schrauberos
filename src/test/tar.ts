/**
 * Baut tar-Archive von Hand (ustar), auch bösartige: Symlinks, Hardlinks, `..`, absolute Pfade, Geräte-Dateien, falsche Größen. Die Archiv-Bibliothek
 * würde solche Einträge beim Packen verweigern oder umschreiben – für die Tests der Abwehr braucht es die rohen Köpfe.
 */
export type RawEntry = {
  name: string;
  /** typeflag: "0" Datei, "5" Ordner, "2" Symlink, "1" Hardlink, "3" Zeichengerät, "4" Blockgerät, "6" FIFO */
  type?: "0" | "5" | "2" | "1" | "3" | "4" | "6";
  linkname?: string;
  data?: string | Buffer;
  /** Größe im Kopf, falls abweichend vom Inhalt (z. B. riesig angekündigt) */
  declaredSize?: number;
};

function field(buffer: Buffer, offset: number, length: number, value: string) {
  buffer.write(value, offset, length, "latin1");
}

function header(entry: RawEntry): Buffer {
  const data = Buffer.from(entry.data ?? "");
  const size = entry.declaredSize ?? data.length;
  const h = Buffer.alloc(512);
  field(h, 0, 100, entry.name);
  field(h, 100, 8, "0000644\0");
  field(h, 108, 8, "0000000\0");
  field(h, 116, 8, "0000000\0");
  if (size < 8 ** 11) field(h, 124, 12, `${size.toString(8).padStart(11, "0")}\0`);
  else {
    // große Größen: GNU-Schreibweise (Basis 256, erstes Byte 0x80)
    h[124] = 0x80;
    for (let i = 0, rest = BigInt(size); i < 11; i++, rest >>= BigInt(8)) h[135 - i] = Number(rest & BigInt(0xff));
  }
  field(h, 136, 12, `${Math.floor(Date.UTC(2026, 0, 1) / 1000).toString(8).padStart(11, "0")}\0`);
  field(h, 148, 8, "        ");
  field(h, 156, 1, entry.type ?? "0");
  field(h, 157, 100, entry.linkname ?? "");
  field(h, 257, 6, "ustar\0");
  field(h, 263, 2, "00");
  const sum = [...h].reduce((a, b) => a + b, 0);
  field(h, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return h;
}

/** Ein Archiv aus rohen Einträgen (unkomprimiert). */
export function rawTar(entries: RawEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    parts.push(header(entry));
    // bei angekündigter Größe ohne passende Daten: nur die vorhandenen Daten anhängen (abgeschnittenes Archiv)
    const data = Buffer.from(entry.data ?? "");
    if (data.length) {
      parts.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) parts.push(Buffer.alloc(pad));
    }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
