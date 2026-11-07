import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CSV_FORMATS, columnSpecs, csvChunks, csvField, csvLine, decodeCsv, detectDelimiter, evaluateImport, formatCents, formatDay, moneyCell, neutralizeFormula, normalizeHeader, parseCents, parseCsv, parseDay, parseDecimal, parseInteger, raw, readTable, undoFormulaGuard, CsvError, CSV_LIMITS, type ImportSpec, type RowCheck } from "./index";

const text = (value: string) => new TextEncoder().encode(value);
const collect = async (iterable: AsyncIterable<string>) => {
  let out = "";
  for await (const chunk of iterable) out += chunk;
  return out;
};

describe("CSV-Leser (RFC 4180)", () => {
  it("liest einfache Zeilen mit Semikolon und Komma", () => {
    assert.deepEqual(parseCsv("a;b;c\r\n1;2;3\r\n").rows, [["a", "b", "c"], ["1", "2", "3"]]);
    assert.deepEqual(parseCsv("a,b\n1,2").rows, [["a", "b"], ["1", "2"]]);
  });

  it("Anführungszeichen: Trennzeichen, doppelte Anführungszeichen und Zeilenumbrüche im Feld", () => {
    const parsed = parseCsv('name;note\r\n"Meier; Anna";"sagt ""Hallo""\r\nzweite Zeile"\r\nX;Y\r\n');
    assert.deepEqual(parsed.rows, [["name", "note"], ["Meier; Anna", 'sagt "Hallo"\r\nzweite Zeile'], ["X", "Y"]]);
    assert.deepEqual(parsed.lines, [1, 2, 4], "Zeilennummern zählen Umbrüche in Feldern mit");
  });

  it("leere Felder, leere Zeilen und abschließender Zeilenumbruch", () => {
    assert.deepEqual(parseCsv("a;b;c\n;;\n\n1;;3\n").rows, [["a", "b", "c"], ["", "", ""], ["1", "", "3"]]);
    assert.deepEqual(parseCsv("a;b\n").rows, [["a", "b"]]);
    assert.deepEqual(parseCsv("").rows, []);
    assert.deepEqual(parseCsv("\n\n\n").rows, []);
  });

  it("verschiedene Zeilenenden: CRLF, LF, CR", () => {
    assert.deepEqual(parseCsv("a;b\r1;2\r3;4").rows, [["a", "b"], ["1", "2"], ["3", "4"]]);
    assert.deepEqual(parseCsv("a;b\n1;2\r\n3;4").rows, [["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("ein Anführungszeichen mitten im Feld bleibt Text (Zoll)", () => {
    assert.deepEqual(parseCsv('Reifen;16" Alu\n').rows, [["Reifen", '16" Alu']]);
  });

  it("nicht geschlossenes Anführungszeichen ist ein Fehler mit Zeile", () => {
    assert.throws(() => parseCsv('a;b\n1;"offen\nnoch eine'), (e) => e instanceof CsvError && e.code === "unterminatedQuote" && e.line === 2);
  });

  it("erkennt das Trennzeichen aus der Kopfzeile, ohne sich von Kommas in Daten täuschen zu lassen", () => {
    assert.equal(detectDelimiter("Name;Straße;Ort\nMeier;Hauptstr. 1, 2. OG;Berlin"), ";");
    assert.equal(detectDelimiter("name,city\n1;2;3;4"), ",");
    assert.equal(detectDelimiter("a\tb\tc\n"), "\t");
    assert.equal(detectDelimiter('"a;b";"c;d"\n'), ";", "Trennzeichen in Anführungszeichen zählen nicht – hier gar keines außerhalb, Standard Semikolon");
    assert.equal(detectDelimiter("einzelspalte\nwert"), ";");
  });

  it("Grenzen: Datensätze, Spalten, Feldlänge", () => {
    assert.throws(() => parseCsv("a\nb\nc\n", { maxRows: 2 }), (e) => e instanceof CsvError && e.code === "tooManyRows");
    assert.equal(parseCsv("a\nb\n", { maxRows: 2 }).rows.length, 2);
    assert.throws(() => parseCsv("a;b;c;d", { maxColumns: 3 }), (e) => e instanceof CsvError && e.code === "tooManyColumns");
    assert.throws(() => parseCsv(`a;${"x".repeat(50)}`, { maxFieldChars: 10 }), (e) => e instanceof CsvError && e.code === "fieldTooLong");
    assert.throws(() => parseCsv(`a;"${"x".repeat(50)}"`, { maxFieldChars: 10 }), (e) => e instanceof CsvError && e.code === "fieldTooLong");
  });

  it("riesige Felder und viele Zeilen innerhalb der Grenzen werden verarbeitet", () => {
    const big = "y".repeat(CSV_LIMITS.fieldChars);
    assert.equal(parseCsv(`a;b\n1;"${big}"`).rows[1][1].length, CSV_LIMITS.fieldChars);
    const many = `a;b\n${Array.from({ length: CSV_LIMITS.importRows }, (_, i) => `${i};x`).join("\n")}`;
    assert.equal(parseCsv(many).rows.length, CSV_LIMITS.importRows + 1);
    const tooMany = `a;b\n${Array.from({ length: CSV_LIMITS.importRows + 1 }, (_, i) => `${i};x`).join("\n")}`;
    assert.throws(() => parseCsv(tooMany), (e) => e instanceof CsvError && e.code === "tooManyRows");
  });
});

describe("CSV-Schreiber und Formelschutz", () => {
  it("quotet nur, wo nötig", () => {
    assert.equal(csvField("Meier", ";"), "Meier");
    assert.equal(csvField("Meier; Anna", ";"), '"Meier; Anna"');
    assert.equal(csvField("Meier, Anna", ";"), "Meier, Anna");
    assert.equal(csvField("Meier, Anna", ","), '"Meier, Anna"');
    assert.equal(csvField('sagt "Hi"', ";"), '"sagt ""Hi"""');
    assert.equal(csvField("zwei\nZeilen", ";"), '"zwei\nZeilen"');
    assert.equal(csvField(" Leerzeichen ", ";"), '" Leerzeichen "');
    assert.equal(csvField(null, ";"), "");
    assert.equal(csvField(undefined, ";"), "");
  });

  it("Formelschutz: = + - @ Tab und Wagenrücklauf am Anfang bekommen ein Anführungszeichen", () => {
    for (const bad of ["=1+1", "+49 170 1234", "-5", "@SUM(A1)", "\t=1", "\r=1", "=HYPERLINK(\"http://x\")", "=cmd|' /C calc'!A0"]) {
      assert.equal(neutralizeFormula(bad), `'${bad}`, bad);
      assert.ok(csvField(bad, ";").replace(/^"/, "").startsWith("'"), bad);
    }
    for (const fine of ["Müller", "5", "a=b", "x+y", " =1", "", "'schon Text"]) assert.equal(neutralizeFormula(fine), fine, fine);
  });

  it("vom Programm erzeugte Zahlen bleiben unangetastet (negativer Betrag ist keine Formel)", () => {
    const format = CSV_FORMATS["excel-de"];
    assert.equal(csvField(moneyCell(-1250, format), ";"), "-12,50");
    assert.equal(csvField(raw("-3"), ";"), "-3");
    assert.equal(csvLine(["=evil", moneyCell(1234567, CSV_FORMATS.international)], ","), "'=evil,12345.67");
  });

  it("Formelschutz und Rücknahme sind Gegenstücke (Rundlauf)", () => {
    for (const value of ["=1+1", "+49 170", "-x", "@a", "\t=x", "normal", "'=wirklich mit Apostroph", "'x"]) {
      const written = neutralizeFormula(value);
      assert.equal(undoFormulaGuard(written), value, value);
    }
  });

  it("Rundlauf: schreiben und wieder lesen ergibt dieselben Werte (Anführungszeichen, Umbrüche, Sonderzeichen)", async () => {
    const rows = [
      ["Meier; Anna", 'sagt "Hallo"', "Zeile 1\r\nZeile 2", "=1+1"],
      ["", "ä ö ü ß €", "  umrahmt  ", "+49 170 1"],
    ];
    for (const format of Object.values(CSV_FORMATS)) {
      const out = await collect(csvChunks(["a", "b", "c", "d"], rows, format));
      assert.ok(out.startsWith("﻿"), "BOM für Excel");
      const parsed = parseCsv(out.slice(1), { delimiter: format.delimiter });
      assert.deepEqual(parsed.rows[0], ["a", "b", "c", "d"]);
      assert.deepEqual(parsed.rows[1].map(undoFormulaGuard), rows[0]);
      assert.deepEqual(parsed.rows[2].map(undoFormulaGuard), rows[1]);
    }
  });

  it("schreibt in Stücken und ohne BOM auf Wunsch; Zeilenende CRLF", async () => {
    const chunks: string[] = [];
    for await (const c of csvChunks(["x"], Array.from({ length: 5 }, (_, i) => [String(i)]), CSV_FORMATS["excel-de"], { bom: false, chunkLines: 2 })) chunks.push(c);
    assert.equal(chunks.length, 4, "Kopfzeile + 2 + 2 + 1");
    assert.equal(chunks.join(""), "x\r\n0\r\n1\r\n2\r\n3\r\n4\r\n");
  });

  it("Zahlen- und Datumsformate", () => {
    assert.equal(formatCents(123456, CSV_FORMATS["excel-de"]), "1234,56");
    assert.equal(formatCents(5, CSV_FORMATS.international), "0.05");
    assert.equal(formatCents(-5, CSV_FORMATS.international), "-0.05");
    assert.equal(formatDay(new Date("2026-03-14T12:00:00")), "2026-03-14");
    assert.equal(parseDay("2026-3-4"), "2026-03-04");
    assert.equal(parseDay("14.03.2026"), "2026-03-14");
    assert.equal(parseDay("1.2.2026"), "2026-02-01");
    assert.equal(parseDay("30.02.2026"), null);
    assert.equal(parseDay("kein Datum"), null);
    assert.equal(parseCents("1.234,56"), 123456);
    assert.equal(parseCents("1234.56"), 123456);
    assert.equal(parseCents("-12,5 €"), -1250);
    assert.equal(parseCents("zwölf"), null);
    assert.equal(parseInteger("1.234"), 1234);
    assert.equal(parseInteger("12 345"), 12345);
    assert.equal(parseInteger("12,5"), null);
    assert.equal(parseDecimal("4,5"), 4.5);
    assert.equal(parseDecimal("x"), null);
  });
});

describe("Zeichensatzerkennung", () => {
  it("UTF-8 mit und ohne BOM", () => {
    assert.deepEqual(decodeCsv(text("﻿Name;Straße")), { text: "Name;Straße", encoding: "utf-8-bom" });
    // TextEncoder schreibt kein BOM von selbst – hier von Hand
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...text("Müller")]);
    assert.deepEqual(decodeCsv(withBom), { text: "Müller", encoding: "utf-8-bom" });
    assert.deepEqual(decodeCsv(text("Müller")), { text: "Müller", encoding: "utf-8" });
  });

  it("Windows-1252 als Rückfall (Excel ohne UTF-8)", () => {
    const win = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x80, 0x20, 0xdf]); // Müller € ß
    assert.deepEqual(decodeCsv(win), { text: "Müller € ß", encoding: "windows-1252" });
  });

  it("UTF-16 mit Kennung", () => {
    const le = new Uint8Array([0xff, 0xfe, ...Buffer.from("Zoë;1", "utf16le")]);
    assert.deepEqual(decodeCsv(le), { text: "Zoë;1", encoding: "utf-16le" });
    const be = Buffer.from("Zoë;1", "utf16le");
    be.swap16();
    assert.deepEqual(decodeCsv(new Uint8Array([0xfe, 0xff, ...be])), { text: "Zoë;1", encoding: "utf-16be" });
  });

  it("Binärdateien (NUL-Bytes ohne UTF-16-Kennung) werden abgelehnt", () => {
    assert.throws(() => decodeCsv(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), (e) => e instanceof CsvError && e.code === "binary");
  });
});

const columns = columnSpecs([
  { key: "number", labelKey: "customers.exchange.cols.customerNumber", aliases: ["Nr"], required: true },
  { key: "city", labelKey: "customers.exchange.cols.city" },
  { key: "notes", labelKey: "customers.exchange.cols.notes", multiline: true },
]);

describe("Tabelle: Überschriften und Zellen", () => {
  it("ordnet Überschriften in beiden Sprachen, mit Alias und unabhängig von Schreibweise zu; unbekannte und doppelte Spalten werden gemeldet", () => {
    const table = readTable(text("KUNDENNUMMER;ort;Foo;city;Notizen\n1;Berlin;x;Köln;a"), columns);
    assert.deepEqual(
      table.headers.map((h) => [h.key, h.reason]),
      [["number", undefined], ["city", undefined], [null, "unknown"], [null, "duplicate"], ["notes", undefined]],
    );
    assert.deepEqual(table.records[0].values, { number: "1", city: "Berlin", notes: "a" });
    assert.deepEqual(readTable(text("Nr;City\n7;Wien"), columns).records[0].values, { number: "7", city: "Wien" });
    assert.deepEqual(readTable(text("Kundennummer\n1"), columns).missing, []);
    assert.deepEqual(readTable(text("Ort\nBerlin"), columns).missing, ["number"]);
  });

  it("normalisiert Überschriften (Umlaute, ß, Satzzeichen)", () => {
    assert.equal(normalizeHeader("Straße"), normalizeHeader("STRASSE"));
    assert.equal(normalizeHeader("E-Mail"), normalizeHeader("email"));
    assert.equal(normalizeHeader(" Kunden-Nr. "), "kundennr");
  });

  it("bereinigt Zellen: Leerraum, Steuerzeichen, Umbrüche nur in Mehrzeilenspalten, Schutz-Anführungszeichen", () => {
    const table = readTable(text('Nr;Ort;Notizen\n"  7  ";"Ber\r\nlin\u0007";"a\r\nb\u0001c"\n\'=x;;\n'), columns);
    assert.deepEqual(table.records[0].values, { number: "7", city: "Ber lin", notes: "a\nbc" });
    assert.deepEqual(table.records[1].values, { number: "=x" }, "der Schutz des Exports wird zurückgenommen");
  });

  it("zählt formelartige Zellen (sie werden als Text übernommen, nie ausgeführt)", () => {
    const table = readTable(text('Nr;Ort\n=1+1;@SUM(A1)\n+SUM(A1);-5\n\'=x;ok\n'), columns);
    assert.equal(table.formulaLike, 3, "=, @, +Text; -5 ist eine Zahl; '=x ist geschützt");
    assert.equal(table.records[0].values.number, "=1+1", "unverändert gespeichert");
  });

  it("überspringt Zeilen ohne bekannte Werte; Zeilennummern bleiben die der Datei", () => {
    const table = readTable(text("Nr;Foo\n1;a\n;b\n\n3;c\n"), columns);
    assert.deepEqual(table.records.map((r) => r.line), [2, 5]);
  });

  it("Dateifehler: leer, nur Leerzeilen, keine bekannte Spalte, zu groß, binär", () => {
    assert.throws(() => readTable(new Uint8Array(), columns), (e) => e instanceof CsvError && e.code === "empty");
    assert.throws(() => readTable(text("\n\n"), columns), (e) => e instanceof CsvError && e.code === "empty");
    assert.throws(() => readTable(text("Foo;Bar\n1;2"), columns), (e) => e instanceof CsvError && e.code === "noHeader");
    assert.throws(() => readTable(new Uint8Array(CSV_LIMITS.importBytes + 1).fill(97), columns), (e) => e instanceof CsvError && e.code === "tooLarge");
    assert.throws(() => readTable(new Uint8Array([78, 114, 0, 0]), columns), (e) => e instanceof CsvError && e.code === "binary");
  });

  it("liest eine in Windows-1252 gespeicherte Datei mit Umlauten", () => {
    const bytes = new Uint8Array([...text("Nr;Ort\n1;K"), 0xf6, ...text("ln")]);
    const table = readTable(bytes, columns);
    assert.equal(table.encoding, "windows-1252");
    assert.equal(table.records[0].values.city, "Köln");
  });
});

type Row = { name: string };
const spec = (known: Set<string>, filesKeys = true): ImportSpec<Row, null> => ({
  columns: [],
  parse: (values) => (values.name === "bad" ? { ok: false, messages: [{ key: "validation.invalid", column: "name" }] } : { ok: true, data: { name: values.name } }),
  check: async (_c, rows) => {
    const out = new Map<number, RowCheck>();
    for (const r of rows) {
      if (known.has(r.data.name)) out.set(r.index, { kind: "duplicate", message: { key: "exchange.row.duplicateInFile" } });
      else if (r.data.name === "gone") out.set(r.index, { kind: "error", message: { key: "validation.invalid" } });
    }
    return out;
  },
  fileKeys: filesKeys ? (d) => [d.name.toLowerCase()] : undefined,
  label: (d) => d.name,
});
const tableOf = (names: string[]) => readTable(text(`name\n${names.join("\n")}`), columnSpecs([{ key: "name", labelKey: "customers.exchange.cols.lastName" }]));

describe("Import-Auswertung", () => {
  it("neu, Dublette in der Datenbank, Dublette in der Datei, Fehler", async () => {
    const plan = await evaluateImport(spec(new Set(["old"])), null, tableOf(["a", "old", "A", "bad", "gone", "b"]), { allowDuplicates: false });
    assert.deepEqual(plan.rows.map((r) => r.status), ["create", "duplicate", "duplicate", "error", "error", "create"]);
    assert.deepEqual(plan.counts, { rows: 6, create: 2, duplicate: 2, error: 2, forced: 0 });
    assert.equal(plan.rows[2].messages[0].key, "exchange.row.duplicateInFile");
  });

  it("Dubletten trotzdem anlegen: werden angelegt und gezählt", async () => {
    const plan = await evaluateImport(spec(new Set(["old"])), null, tableOf(["old", "a", "a"]), { allowDuplicates: true });
    assert.deepEqual(plan.rows.map((r) => r.status), ["create", "create", "create"]);
    assert.deepEqual(plan.counts, { rows: 3, create: 3, duplicate: 0, error: 0, forced: 2 });
    assert.deepEqual(plan.rows.map((r) => !!r.forced), [true, false, true]);
  });

  it("Zeilen mit Fehlern verändern das Ergebnis der anderen nicht", async () => {
    const plan = await evaluateImport(spec(new Set()), null, tableOf(["bad", "x", "gone", "y"]), { allowDuplicates: false });
    assert.deepEqual(plan.rows.filter((r) => r.status === "create").map((r) => r.data?.name), ["x", "y"]);
    assert.deepEqual(plan.rows.map((r) => r.line), [2, 3, 4, 5]);
  });
});
