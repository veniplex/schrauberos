import PDFDocument from "pdfkit";
import { qrMatrix, QrTooLongError } from "@/lib/qr";
import { PdfError } from "./errors";
import { loadFonts } from "./fonts";

/**
 * Einfache Layout-API für Geschäftsdokumente (Rechnung, Angebot, Auftragskarte, Etikett). Dahinter steckt `pdfkit` (reines JavaScript, kein Browser, keine Systemschrift): Die Schrift
 * (Noto Sans) wird eingebettet, Text ist durchsuchbar, Seiten brechen von selbst um. Das Layout läuft **von oben nach unten** – jede Methode setzt dort fort, wo die vorige aufgehört hat –
 * und bricht vor Zeilen, Tabellenzeilen und Summenblöcken um, die nicht mehr passen (nie mitten in einer Tabellenzeile). Tabellenköpfe wiederholen sich auf jeder Folgeseite.
 * Kopf- und Fußzeile (Seitenzahl „Seite 2 von 3“) entstehen erst am Ende, wenn die Seitenzahl feststeht.
 *
 * Keine Funktion hier kennt Fachlogik; die Fachfunktionen (Rechnung, Etikett …) bauen ihr Dokument mit diesen Bausteinen. Das Ergebnis ist ein einfaches PDF ohne PDF/A
 * (Entscheidung und Begründung: README, Abschnitt „PDF-Erzeugung“).
 */

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
/** Millimeter → Punkt (PDF-Einheit, 1/72 Zoll) */
export const mm = (value: number) => (value * 72) / 25.4;

const INK = "#1a1d23";
const MUTED = "#5b6270";
const LINE = "#c4c9d2";
const ZEBRA = "#f2f4f7";
const HEAD = "#e6e9ee";

export type PdfAlign = "left" | "right" | "center" | "justify";
export type TextStyle = {
  /** Schriftgröße in Punkt (Standard 10) */
  size?: number;
  bold?: boolean;
  /** Muted = gedämpfte Farbe (Hinweise, Beschriftungen) */
  muted?: boolean;
  color?: string;
  align?: PdfAlign;
  /** Breite des Textblocks (Standard: ganze Inhaltsbreite) */
  width?: number;
  /** linker Rand des Blocks (Standard: Seitenrand) */
  x?: number;
  /** Abstand nach dem Block in Punkt */
  after?: number;
  lineGap?: number;
};
export type TableColumn = { header: string; /** relative Breite (Standard 1) */ weight?: number; align?: PdfAlign };
export type TableSpec = {
  columns: readonly TableColumn[];
  rows: ReadonlyArray<readonly string[]>;
  fontSize?: number;
  /** Streifen in jeder zweiten Zeile (Standard an) */
  zebra?: boolean;
  /** Kopfzeile auf Folgeseiten wiederholen (Standard an) */
  repeatHeader?: boolean;
};
export type TotalsRow = { label: string; value: string; strong?: boolean };
export type PdfOptions = {
  title: string;
  author?: string;
  subject?: string;
  keywords?: string;
  /** Dokumentsprache (BCP 47), Standard „de-DE“ */
  language?: string;
  /** Erstellzeit (Standard: jetzt) – feste Zeit macht die Ausgabe wiederholbar */
  creationDate?: Date;
  /** Seitengröße in Punkt (Standard A4 hochkant); Etiketten und A5/A6-Zettel setzen sie. Zulässig: 30 bis 1200 Punkt je Seite. */
  pageSize?: { width: number; height: number };
  /** Seitenränder in Punkt; unten bleibt Platz für die Fußzeile */
  margins?: Partial<Record<"top" | "right" | "bottom" | "left", number>>;
  /** Fußzeile mit Seitenzahl; `false` schaltet sie ab */
  footer?: false | { text?: string; pageLabel?: (page: number, total: number) => string };
  /** Zeile oben auf jeder Folgeseite (Dokumentnummer, Firma) */
  runningHeader?: string;
  /** Grenzen (Schutz vor außer Kontrolle geratenen Dokumenten) */
  maxPages?: number;
  maxBytes?: number;
};

/** Zulässige Seitenkante in Punkt (etwa 10 mm bis 423 mm). */
export const MIN_PAGE_POINTS = 30;
export const MAX_PAGE_POINTS = 1200;

export const DEFAULT_MAX_PAGES = 200;
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/** Steuerzeichen (außer Zeilenumbruch) und Zeichen, die die Schrift nicht kennt und die nur stören, entfernen (als Escapes geschrieben, damit sie im Quelltext sichtbar bleiben). */
const UNWANTED = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
export function cleanPdfText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(UNWANTED, "").normalize("NFC");
}

/** Grenzen gegen außer Kontrolle geratene Eingaben: pdfkit bricht sehr lange Wörter in quadratischer Zeit um (40 000 Zeichen ohne Leerzeichen erschöpfen den Speicher). */
export const MAX_TEXT_CHARS = 20_000;
export const MAX_DOCUMENT_CHARS = 400_000;
export const MAX_TABLE_ROWS = 3_000;
export const MAX_TABLE_COLUMNS = 24;
/** Wörter ohne Leerraum werden vorab nach so vielen Zeichen hart umbrochen (linearer Aufwand; bei Kennungen und Adressen sieht das kaum anders aus als der Umbruch am Zeilenende). */
export const MAX_WORD_CHARS = 80;
/** Größte Bilddatei für `image()` (Logo, Unterschrift); pdfkit dekodiert PNG synchron. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Bricht jede Folge ohne Leerraum, die länger als `limit` ist, mit einem Zeilenumbruch auf (linear). */
export function breakLongWords(value: string, limit = MAX_WORD_CHARS): string {
  if (value.length <= limit) return value;
  let out = "";
  let run = 0;
  for (const char of value) {
    if (/\s/.test(char)) {
      run = 0;
    } else {
      if (run >= limit) {
        out += "\n";
        run = 0;
      }
      run++;
    }
    out += char;
  }
  return out;
}

/** Einzeiliger Text (Kopf-/Fußzeile, Summenzeilen): bereinigt, ohne Zeilenumbrüche und auf eine feste Länge begrenzt, damit er nie über den Rand läuft. */
function oneLine(value: string, max: number): string {
  const text = cleanPdfText(value).replace(/\n/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type Doc = InstanceType<typeof PDFDocument>;

export class PdfBuilder {
  private readonly doc: Doc;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<void>;
  private readonly margins: { top: number; right: number; bottom: number; left: number };
  private readonly options: PdfOptions;
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private finished = false;
  /** bisher gesetzte Zeichen (Summe aller Texte und Zellen) – Obergrenze `MAX_DOCUMENT_CHARS` */
  private chars = 0;

  constructor(options: PdfOptions) {
    this.options = options;
    const size = options.pageSize;
    if (size && !(size.width >= MIN_PAGE_POINTS && size.width <= MAX_PAGE_POINTS && size.height >= MIN_PAGE_POINTS && size.height <= MAX_PAGE_POINTS)) throw new PdfError("invalid", "pageSize");
    this.pageWidth = size?.width ?? A4_WIDTH;
    this.pageHeight = size?.height ?? A4_HEIGHT;
    this.margins = { top: mm(20), right: mm(20), bottom: mm(22), left: mm(20), ...options.margins };
    const fonts = loadFonts();
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const info: Record<string, string | Date> = {
      Title: cleanPdfText(options.title).slice(0, 200),
      Producer: "SchrauberOS",
      Creator: "SchrauberOS",
      CreationDate: options.creationDate ?? new Date(),
    };
    if (options.author) info.Author = cleanPdfText(options.author).slice(0, 200);
    if (options.subject) info.Subject = cleanPdfText(options.subject).slice(0, 200);
    if (options.keywords) info.Keywords = cleanPdfText(options.keywords).slice(0, 400);
    // `font` als Puffer: pdfkit lädt dann nicht die eingebaute Helvetica (Dateien neben der Bibliothek) – das Paket braucht nur die eigene Schrift
    this.doc = new PDFDocument({ size: [this.pageWidth, this.pageHeight], margins: this.margins, bufferPages: true, font: fonts.regular as unknown as string, info, lang: options.language ?? "de-DE", displayTitle: true });
    this.doc.registerFont("regular", fonts.regular as unknown as string);
    this.doc.registerFont("bold", fonts.bold as unknown as string);
    this.doc.on("data", (chunk: Buffer) => this.chunks.push(chunk));
    this.done = new Promise((resolve, reject) => {
      this.doc.on("end", resolve);
      this.doc.on("error", reject);
    });
    // auch die automatischen Umbrüche von pdfkit mitzählen
    this.doc.on("pageAdded", () => {
      if (this.doc.bufferedPageRange().count > maxPages) throw new PdfError("tooManyPages", String(maxPages));
    });
  }

  /**
   * Bereitet jeden Text vor, bevor er an pdfkit geht: bereinigt, begrenzt (Länge je Text und im ganzen Dokument; Überschreitung ist ein `PdfError("tooLarge")`, kein stilles Kürzen) und bricht
   * sehr lange Wörter hart um. So bleibt der Aufwand linear und der Speicherbedarf beschränkt.
   */
  private prep(value: string): string {
    const clean = cleanPdfText(value);
    if (clean.length > MAX_TEXT_CHARS) throw new PdfError("tooLarge", "text");
    this.chars += clean.length;
    if (this.chars > MAX_DOCUMENT_CHARS) throw new PdfError("tooLarge", "document");
    return breakLongWords(clean);
  }

  /* ------------------------------------------------------------ Maße */

  get left(): number {
    return this.margins.left;
  }
  get right(): number {
    return this.pageWidth - this.margins.right;
  }
  get contentWidth(): number {
    return this.pageWidth - this.margins.left - this.margins.right;
  }
  /** aktuelle Schreibposition von oben (Punkt) */
  get y(): number {
    return this.doc.y;
  }
  set y(value: number) {
    this.doc.y = value;
  }
  /** unterste Zeile, die noch auf die Seite passt */
  get limit(): number {
    return this.pageHeight - this.margins.bottom;
  }
  get pageCount(): number {
    return this.doc.bufferedPageRange().count;
  }

  private font(bold: boolean, size: number) {
    this.doc.font(bold ? "bold" : "regular").fontSize(size);
  }

  /** Sorgt dafür, dass `height` Punkt noch auf die Seite passen – sonst neue Seite. Gibt zurück, ob umgebrochen wurde. */
  ensure(height: number): boolean {
    if (this.doc.y + height <= this.limit + 0.01) return false;
    if (this.doc.y <= this.margins.top + 0.01) return false; // schon oben auf einer leeren Seite: umbrechen brächte nichts
    this.doc.addPage();
    return true;
  }

  pageBreak(): this {
    this.doc.addPage();
    return this;
  }

  space(points: number): this {
    this.doc.y += points;
    return this;
  }

  /* ------------------------------------------------------------ Text */

  text(value: string, style: TextStyle = {}): this {
    return this.put(this.prep(value), style);
  }

  private put(text: string, style: TextStyle): this {
    const { size = 10, bold = false, muted = false, color, align = "left", width = this.contentWidth, x = this.left, after = 0, lineGap = 1.5 } = style;
    this.font(bold, size);
    const height = this.doc.heightOfString(text, { width, align, lineGap });
    if (height <= this.limit - this.margins.top) this.ensure(height);
    this.doc.fillColor(color ?? (muted ? MUTED : INK)).text(text, x, this.doc.y, { width, align, lineGap });
    this.doc.y += after;
    return this;
  }

  heading(value: string, level: 1 | 2 | 3 = 1): this {
    const size = { 1: 17, 2: 12.5, 3: 10.5 }[level];
    const before = this.doc.y > this.margins.top + 1 ? { 1: 8, 2: 10, 3: 6 }[level] : 0;
    this.font(true, size);
    const text = this.prep(value);
    const height = this.doc.heightOfString(text, { width: this.contentWidth });
    this.ensure(before + height + 24); // eine Überschrift steht nie allein am Seitenende
    this.doc.y += before;
    return this.put(text, { size, bold: true, after: level === 1 ? 8 : 4 });
  }

  rule(): this {
    this.ensure(8);
    const y = this.doc.y + 3;
    this.doc.moveTo(this.left, y).lineTo(this.right, y).lineWidth(0.6).strokeColor(LINE).stroke();
    this.doc.y = y + 5;
    return this;
  }

  /** Beschriftung links, Wert rechts daneben (Anschrift, Kopfdaten, Rechnungsdaten). */
  keyValues(rows: ReadonlyArray<readonly [string, string]>, options: { labelWidth?: number; size?: number; /** Breite des ganzen Blocks (Standard: Inhaltsbreite) – z. B. neben einem QR-Code */ width?: number } = {}): this {
    const size = options.size ?? 9.5;
    const labelWidth = options.labelWidth ?? mm(40);
    const total = options.width ?? this.contentWidth;
    const gap = 8;
    for (const [label, value] of rows) {
      this.font(false, size);
      const labelText = this.prep(label);
      const valueText = this.prep(value);
      const height = Math.max(this.doc.heightOfString(labelText, { width: labelWidth }), this.doc.heightOfString(valueText, { width: total - labelWidth - gap }));
      this.ensure(height + 2);
      const top = this.doc.y;
      this.doc.fillColor(MUTED).text(labelText, this.left, top, { width: labelWidth });
      this.font(false, size);
      this.doc.fillColor(INK).text(valueText, this.left + labelWidth + gap, top, { width: total - labelWidth - gap });
      this.doc.y = top + height + 2;
    }
    return this;
  }

  /* ------------------------------------------------------------ Tabelle */

  table(spec: TableSpec): this {
    if (spec.columns.length === 0 || spec.columns.length > MAX_TABLE_COLUMNS) throw new PdfError("invalid", "columns");
    if (spec.rows.length > MAX_TABLE_ROWS) throw new PdfError("tooLarge", "rows");
    const columnCount = spec.columns.length;
    // alle Zellen einmal vorbereiten (Länge, Wortbruch); zu kurze Zeilen werden aufgefüllt, überzählige Zellen verworfen
    const prepare = (cells: readonly string[]) => Array.from({ length: columnCount }, (_, i) => this.prep(cells[i] ?? ""));
    const head = spec.columns.map((c) => this.prep(c.header));
    const body = spec.rows.map(prepare);
    const size = spec.fontSize ?? 9.5;
    const pad = 4;
    const weights = spec.columns.map((c) => c.weight ?? 1);
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (this.contentWidth * w) / total);
    const offsets = widths.map((_, i) => this.left + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const cellHeight = (cells: readonly string[], bold: boolean) => {
      this.font(bold, size);
      return Math.max(...cells.map((cell, i) => this.doc.heightOfString(cell, { width: widths[i] - 2 * pad, align: spec.columns[i].align ?? "left" }))) + 2 * pad;
    };
    const drawRow = (cells: readonly string[], bold: boolean, fill: string | null) => {
      const height = cellHeight(cells, bold);
      const top = this.doc.y;
      if (fill) this.doc.rect(this.left, top, this.contentWidth, height).fill(fill);
      this.font(bold, size);
      this.doc.fillColor(INK);
      cells.forEach((cell, i) => this.doc.text(cell, offsets[i] + pad, top + pad, { width: widths[i] - 2 * pad, align: spec.columns[i].align ?? "left" }));
      this.doc.moveTo(this.left, top + height).lineTo(this.right, top + height).lineWidth(0.4).strokeColor(LINE).stroke();
      this.doc.y = top + height;
    };
    const header = head;
    const headerHeight = cellHeight(header, true);
    const firstRow = body[0] ? cellHeight(body[0], false) : 0;
    this.ensure(headerHeight + firstRow); // Kopf und mindestens eine Zeile zusammen
    drawRow(header, true, HEAD);
    body.forEach((row, index) => {
      const height = cellHeight(row, false);
      if (this.doc.y + height > this.limit + 0.01) {
        this.doc.addPage();
        if (spec.repeatHeader !== false) drawRow(header, true, HEAD);
      }
      drawRow(row, false, spec.zebra !== false && index % 2 === 1 ? ZEBRA : null);
    });
    this.doc.y += 4;
    return this;
  }

  /** Summenblock am rechten Rand (Netto, Steuer, Gesamt); bleibt zusammen und bricht nie mittendrin um. */
  totals(rows: readonly TotalsRow[], options: { width?: number; size?: number } = {}): this {
    const width = options.width ?? mm(78);
    const size = options.size ?? 10;
    const lineHeight = size + 6;
    const height = rows.reduce((sum, row) => sum + lineHeight + (row.strong ? 4 : 0), 0);
    this.ensure(height + 4);
    const x = this.right - width;
    for (const row of rows) {
      if (row.strong) {
        this.doc.moveTo(x, this.doc.y + 1).lineTo(this.right, this.doc.y + 1).lineWidth(0.8).strokeColor(INK).stroke();
        this.doc.y += 4;
      }
      const top = this.doc.y;
      this.font(Boolean(row.strong), row.strong ? size + 1 : size);
      this.doc.fillColor(INK);
      this.doc.text(oneLine(row.label, 80), x, top, { width: width * 0.58, lineBreak: false });
      this.doc.text(oneLine(row.value, 60), x + width * 0.58, top, { width: width * 0.42, align: "right", lineBreak: false });
      this.doc.y = top + lineHeight;
    }
    return this;
  }

  /* ------------------------------------------------------------ Grafik */

  /**
   * QR-Code als Vektorgrafik (kein Bild, kein Dienst): `data` ist der Inhalt (meist ein Link). Mit Ruhezone von zwei Modulen auf weißem Grund. Ohne `x`/`y` im Textfluss
   * (Kantenlänge `size` Punkt, danach geht es darunter weiter), mit beiden an fester Stelle.
   */
  qr(data: string, options: { size?: number; x?: number; y?: number } = {}): this {
    const size = options.size ?? mm(28);
    const placed = options.y !== undefined;
    if (!placed) this.ensure(size);
    const x = options.x ?? this.left;
    const y = options.y ?? this.doc.y;
    let matrix;
    try {
      matrix = qrMatrix(data);
    } catch (error) {
      throw error instanceof QrTooLongError ? new PdfError("tooLarge", "qr") : error;
    }
    const quiet = 2;
    const cell = size / (matrix.size + 2 * quiet);
    this.doc.rect(x, y, size, size).fill("#ffffff");
    this.doc.fillColor("#000000");
    matrix.rows.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        if (row[c] !== "1") {
          c++;
          continue;
        }
        let end = c;
        while (end < row.length && row[end] === "1") end++;
        this.doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, (end - c) * cell, cell + 0.15).fill();
        c = end;
      }
    });
    if (!placed) this.doc.y = y + size + 4;
    return this;
  }

  /** Bild (PNG/JPEG, z. B. das Firmenlogo) in den Textfluss oder an eine feste Stelle. */
  image(data: Buffer | Uint8Array, options: { width?: number; height?: number; x?: number; y?: number } = {}): this {
    if (data.byteLength > MAX_IMAGE_BYTES) throw new PdfError("tooLarge", "image");
    const placed = options.y !== undefined;
    const fit: [number, number] = [options.width ?? mm(40), options.height ?? mm(20)];
    if (!placed) this.ensure(fit[1]);
    const y = options.y ?? this.doc.y;
    this.doc.image(Buffer.from(data), options.x ?? this.left, y, { fit });
    if (!placed) this.doc.y = y + fit[1] + 4;
    return this;
  }

  /* ------------------------------------------------------------ Feste Stellen (Etiketten, Karten) */

  /**
   * Größte Schriftgröße (in Halbpunkt-Schritten von `max` bis `min`), mit der `value` in einen Kasten aus `width` × `height` Punkt passt – für Etiketten, deren Text unterschiedlich lang ist (Kennzeichen,
   * Lagerort). Passt es auch mit `min` nicht, ist es `min` (der Text wird dann in `textAt` am Kastenrand abgeschnitten, nie über ihn hinaus gesetzt).
   */
  fitSize(value: string, box: { width: number; height: number }, options: { max: number; min?: number; bold?: boolean; lineGap?: number }): number {
    const text = this.prep(value);
    const min = options.min ?? 5;
    const lineGap = options.lineGap ?? 1;
    for (let size = options.max; size > min; size -= 0.5) {
      this.font(options.bold ?? false, size);
      if (this.doc.heightOfString(text, { width: box.width, lineGap }) <= box.height + 0.01) return size;
    }
    return min;
  }

  /**
   * Text in einen Kasten an fester Stelle (Punkt von links oben der Seite). Nichts läuft über den Kasten hinaus: Was nicht mehr passt, wird mit „…“ abgeschnitten. Setzt die Schreibposition
   * (`y`) nicht fort und bricht nie auf eine neue Seite um. Liefert die belegte Höhe.
   */
  textAt(value: string, box: { x: number; y: number; width: number; height: number }, style: Omit<TextStyle, "x" | "width" | "after"> & { valign?: "top" | "middle" } = {}): number {
    const { size = 10, bold = false, muted = false, color, align = "left", lineGap = 1, valign = "top" } = style;
    const text = this.prep(value);
    this.font(bold, size);
    const used = Math.min(box.height, this.doc.heightOfString(text, { width: box.width, align, lineGap }));
    const top = valign === "middle" ? box.y + (box.height - used) / 2 : box.y;
    this.doc.fillColor(color ?? (muted ? MUTED : INK)).text(text, box.x, top, { width: box.width, height: valign === "middle" ? used + 0.5 : box.height, align, lineGap, ellipsis: true });
    return used;
  }

  /** Rahmen und/oder Fläche an fester Stelle (Etikettenrand, Kästchen zum Abhaken, Schreibfläche für Notizen). */
  rectAt(box: { x: number; y: number; width: number; height: number }, options: { stroke?: boolean; fill?: string; lineWidth?: number; dash?: number } = {}): this {
    if (options.fill) this.doc.rect(box.x, box.y, box.width, box.height).fill(options.fill);
    if (options.stroke) {
      this.doc.save();
      if (options.dash) this.doc.dash(options.dash, { space: options.dash });
      this.doc.rect(box.x, box.y, box.width, box.height).lineWidth(options.lineWidth ?? 0.6).strokeColor(LINE).stroke();
      this.doc.restore();
    }
    return this;
  }

  /** Linie an fester Stelle (Schreiblinien, Trennlinie). */
  lineAt(x1: number, y1: number, x2: number, y2: number, options: { lineWidth?: number; dark?: boolean } = {}): this {
    this.doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(options.lineWidth ?? 0.5).strokeColor(options.dark ? INK : LINE).stroke();
    return this;
  }

  /* ------------------------------------------------------------ Ende */

  private decoratePages(): void {
    const total = this.doc.bufferedPageRange().count;
    const footer = this.options.footer;
    for (let index = 0; index < total; index++) {
      this.doc.switchToPage(index);
      this.doc.page.margins.bottom = 0; // sonst bricht pdfkit für Text im unteren Rand eine neue Seite um
      this.doc.page.margins.top = 0;
      if (this.options.runningHeader && index > 0) {
        this.font(false, 8);
        this.doc.fillColor(MUTED).text(oneLine(this.options.runningHeader, 200), this.left, mm(10), { width: this.contentWidth, lineBreak: false });
      }
      if (footer !== false) {
        const label = (footer?.pageLabel ?? ((page: number, count: number) => `Seite ${page} von ${count}`))(index + 1, total);
        const y = this.pageHeight - mm(12);
        this.font(false, 8);
        this.doc.fillColor(MUTED);
        if (footer?.text) this.doc.text(oneLine(footer.text, 160), this.left, y, { width: this.contentWidth * 0.7, lineBreak: false });
        this.doc.text(oneLine(label, 80), this.left, y, { width: this.contentWidth, align: "right", lineBreak: false });
      }
    }
  }

  /** Schließt das Dokument ab (Kopf-/Fußzeilen, Seitenzahlen) und liefert die Bytes. */
  async finish(): Promise<Buffer> {
    if (this.finished) throw new PdfError("invalid", "finish zweimal");
    this.finished = true;
    this.decoratePages();
    this.doc.flushPages();
    this.doc.end();
    await this.done;
    const bytes = Buffer.concat(this.chunks);
    if (bytes.length > (this.options.maxBytes ?? DEFAULT_MAX_BYTES)) throw new PdfError("tooLarge", String(bytes.length));
    return bytes;
  }
}

export function createPdf(options: PdfOptions): PdfBuilder {
  return new PdfBuilder(options);
}
