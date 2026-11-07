import { inflateSync } from "node:zlib";

/**
 * Kleiner PDF-Leser **nur für Tests**: zählt Seiten, liest den Text jeder Seite (über die ToUnicode-Tabellen der eingebetteten Schriften, so wie es auch ein Textauszug im PDF-Betrachter
 * tut) und nennt die eingebetteten Schriften. Es versteht genau das, was `pdfkit` schreibt (Schriften als zusammengesetzte Type0-Schriften mit Identity-H, Inhalt als Flate-Strom) – kein
 * allgemeiner PDF-Parser. Gedacht, um „Umlaute und Euro-Zeichen kommen richtig an“ und „der Text ist durchsuchbar“ am fertigen PDF zu prüfen, nicht an der Zeichenfolge im Quelltext.
 */
export type PdfInspection = {
  pageCount: number;
  /** Text je Seite: eine Zeile je Textblock */
  pages: string[];
  /** Seiteninhalt (Zeichenbefehle) je Seite im Klartext – für Strukturprüfungen wie „der QR-Code ist gezeichnet“ */
  contents: string[];
  /** BaseFont-Namen der eingebetteten Schriften (mit Subset-Präfix) */
  fonts: string[];
  /** Dokument-Info (Title usw.) als Text, soweit lesbar */
  info: Record<string, string>;
  /** Klartext des gesamten Dokuments außerhalb der Ströme (für Strukturprüfungen: Anhänge, Metadaten, Ausgabeprofil) */
  structure: string;
};

type PdfObject = { dict: string; stream: Buffer | null };

function parseObjects(raw: Buffer): Map<number, PdfObject> {
  const text = raw.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(?:^|[\r\n])(\d+) 0 obj\b/g;
  const starts: Array<{ id: number; at: number; bodyAt: number }> = [];
  for (let m = header.exec(text); m; m = header.exec(text)) starts.push({ id: Number(m[1]), at: m.index, bodyAt: m.index + m[0].length });
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : text.length;
    const body = text.slice(start.bodyAt, end);
    const streamAt = body.indexOf("stream");
    // der Beginn von „stream“ gilt nur, wenn davor das Wörterbuch endet
    if (streamAt >= 0 && /endobj/.test(body) === true && body.slice(0, streamAt).trimEnd().endsWith(">>")) {
      const dict = body.slice(0, streamAt);
      let from = start.bodyAt + streamAt + "stream".length;
      if (text[from] === "\r") from++;
      if (text[from] === "\n") from++;
      const to = text.indexOf("endstream", from);
      let data = raw.subarray(from, to);
      // vor „endstream“ steht ein Zeilenende, das nicht zum Inhalt gehört (bei Flate-Strömen ist es unschädlich)
      if (/\/FlateDecode/.test(dict)) {
        try {
          data = inflateSync(data);
        } catch {
          data = inflateSync(raw.subarray(from, to - 1));
        }
      }
      objects.set(start.id, { dict, stream: Buffer.from(data) });
    } else {
      objects.set(start.id, { dict: body.replace(/endobj[\s\S]*$/, ""), stream: null });
    }
  });
  return objects;
}

/** ToUnicode-Tabelle (bfchar und bfrange) → Glyphe → Zeichen */
function parseCMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const unicode = (hex: string) => {
    let out = "";
    for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(pair[1], 16), unicode(pair[2]));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const from = parseInt(range[1], 16);
      const to = parseInt(range[2], 16);
      if (range[3].startsWith("[")) {
        [...range[3].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((entry, i) => map.set(from + i, unicode(entry[1])));
      } else {
        const base = unicode(range[3].slice(1, -1));
        for (let code = from; code <= to; code++) map.set(code, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (code - from)));
      }
    }
  }
  return map;
}

const refOf = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  return m ? Number(m[1]) : null;
};

export function inspectPdf(bytes: Uint8Array): PdfInspection {
  const raw = Buffer.from(bytes);
  const objects = parseObjects(raw);
  const pages = [...objects.values()].filter((o) => /\/Type\s*\/Page(?![s\w])/.test(o.dict));

  const cmaps = new Map<number, Map<number, string>>();
  const cmapOfFont = (fontId: number) => {
    if (!cmaps.has(fontId)) {
      const toUnicode = refOf(objects.get(fontId)?.dict ?? "", "ToUnicode");
      const stream = toUnicode ? objects.get(toUnicode)?.stream : null;
      cmaps.set(fontId, stream ? parseCMap(stream.toString("latin1")) : new Map());
    }
    return cmaps.get(fontId)!;
  };

  const contents: string[] = [];
  const texts = pages.map((page) => {
    const resourcesId = refOf(page.dict, "Resources");
    const resources = resourcesId ? (objects.get(resourcesId)?.dict ?? "") : page.dict;
    const fontBlock = /\/Font\s*<<([^>]*)>>/.exec(resources)?.[1] ?? "";
    const fonts = new Map<string, number>();
    for (const m of fontBlock.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) fonts.set(m[1], Number(m[2]));
    const contentsRef = refOf(page.dict, "Contents");
    const content = contentsRef ? (objects.get(contentsRef)?.stream?.toString("latin1") ?? "") : "";
    contents.push(content);
    const lines: string[] = [];
    for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
      let line = "";
      let current = new Map<number, string>();
      for (const op of block[1].matchAll(/\/(\w+)\s+[\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
        if (op[1]) {
          const id = fonts.get(op[1]);
          current = id ? cmapOfFont(id) : new Map();
        } else {
          const hex = op[2] !== undefined ? [...op[2].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]).join("") : op[3];
          for (let i = 0; i + 4 <= hex.length; i += 4) line += current.get(parseInt(hex.slice(i, i + 4), 16)) ?? "�";
        }
      }
      if (line) lines.push(line);
    }
    return lines.join("\n");
  });

  const fonts = [...objects.values()].map((o) => /\/Type\s*\/Font\b[\s\S]*\/BaseFont\s*\/([^\s/]+)/.exec(o.dict)?.[1]).filter((n): n is string => Boolean(n) && /^[A-Z]{6}\+/.test(n as string));

  const info: Record<string, string> = {};
  const infoId = refOf(/trailer[\s\S]*$/.exec(raw.toString("latin1"))?.[0] ?? "", "Info");
  if (infoId) {
    const dict = objects.get(infoId)?.dict ?? "";
    for (const m of dict.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
      const value = objects.get(Number(m[2]))?.dict.trim() ?? "";
      const inner = /^\(([\s\S]*)\)$/.exec(value)?.[1];
      if (inner === undefined) continue;
      // Textzeichenfolgen sind UTF-16BE mit Byte-Order-Marke (þÿ) oder einfach
      info[m[1]] = inner.startsWith("þÿ") ? Buffer.from(inner, "latin1").subarray(2).swap16().toString("utf16le") : inner;
    }
  }

  const structure = [...objects.values()].map((o) => o.dict).join("\n");
  return { pageCount: pages.length, pages: texts, contents, fonts: [...new Set(fonts)], info, structure };
}
