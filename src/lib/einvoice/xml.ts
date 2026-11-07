/**
 * Schmaler XML-Leser für elektronische Rechnungen (XRechnung/ZUGFeRD in den Syntaxen UBL und CII) – **kein** allgemeiner XML-Parser.
 *
 * Er ist absichtlich so klein, dass sich seine Sicherheit überblicken lässt:
 *  - **Keine DTD, keine Entitäten:** `<!DOCTYPE`, `<!ENTITY` und jede Entitätsreferenz außer den fünf vordefinierten (`&amp; &lt; &gt; &quot; &apos;`) und Zeichenverweisen
 *    (`&#65;`, `&#x41;`) werden abgelehnt. Es gibt nichts, was nachgeladen oder vervielfacht werden könnte (kein XXE, kein „Billion Laughs“, kein Zugriff auf Dateien oder Netz).
 *  - **Keine Verarbeitungsanweisungen** außer der XML-Deklaration ganz am Anfang (also auch kein `xml-stylesheet`).
 *  - **Obergrenzen** für Größe, Verschachtelung, Elemente, Attribute und Namenslänge; jede Grenze ergibt einen Fehler statt einer langen Rechnung.
 *  - **Linear:** eine einzige Vorwärtsschleife über den Text mit `indexOf`/`charCodeAt`, keine rückwärts suchenden regulären Ausdrücke auf Eingabe-Text (ReDoS-frei,
 *    Lehre aus ZP5-3). Die einzigen Ausdrücke prüfen höchstens `MAX_NAME` Zeichen.
 *  - Nur **UTF-8** (mit oder ohne Byte-Order-Mark); XRechnung schreibt UTF-8 vor.
 *
 * Das Ergebnis ist ein Baum aus Elementen mit lokalem Namen, aufgelöstem Namensraum, Attributen und dem (getrimmten) Text. Mehr braucht die Auswertung nicht.
 */

export type XmlErrorCode = "tooLarge" | "encoding" | "malformed" | "doctype" | "entity" | "instruction" | "tooDeep" | "tooManyNodes" | "tooManyAttributes" | "notXml";

export class XmlError extends Error {
  constructor(readonly code: XmlErrorCode) {
    super(`xml:${code}`);
    this.name = "XmlError";
  }
}

export type XmlElement = {
  /** lokaler Name ohne Präfix */
  name: string;
  /** Namensraum-URI (aufgelöst über `xmlns`), `""` ohne */
  ns: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Text direkt in diesem Element, getrimmt (Mischinhalt wird zusammengesetzt) */
  text: string;
};

export const XML_LIMITS = { bytes: 10 * 1024 * 1024, depth: 48, elements: 200_000, attributes: 64, name: 128, text: 1_000_000 } as const;

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** Zeichen, die in XML 1.0 vorkommen dürfen (ohne Steuerzeichen außer Tab, LF, CR). */
function allowedChar(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

/** Löst Zeichen- und die fünf vordefinierten Entitätsverweise auf; alles andere ist ein Fehler. Linear. */
function decode(raw: string): string {
  let amp = raw.indexOf("&");
  if (amp < 0) return raw;
  let out = "";
  let from = 0;
  while (amp >= 0) {
    out += raw.slice(from, amp);
    const semi = raw.indexOf(";", amp + 1);
    if (semi < 0 || semi - amp > 12) throw new XmlError("entity");
    const ref = raw.slice(amp + 1, semi);
    if (ref.startsWith("#")) {
      const hex = ref[1] === "x";
      const digits = ref.slice(hex ? 2 : 1);
      if (digits.length === 0 || digits.length > 7 || !(hex ? /^[0-9A-Fa-f]+$/ : /^[0-9]+$/).test(digits)) throw new XmlError("entity");
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!allowedChar(code)) throw new XmlError("entity");
      out += String.fromCodePoint(code);
    } else {
      const value = Object.hasOwn(PREDEFINED, ref) ? PREDEFINED[ref] : undefined;
      if (value === undefined) throw new XmlError("entity"); // jede andere (auch eine in einer DTD vereinbarte) Entität
      out += value;
    }
    from = semi + 1;
    amp = raw.indexOf("&", from);
  }
  return out + raw.slice(from);
}

type Scope = Map<string, string>;

/** Liest ein Dokument. Wirft `XmlError`; alles, was nicht eindeutig harmlos ist, wird abgelehnt. */
export function parseXml(bytes: Uint8Array): XmlElement {
  if (bytes.length > XML_LIMITS.bytes) throw new XmlError("tooLarge");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new XmlError("encoding");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const length = text.length;
  let pos = 0;
  while (pos < length && isSpace(text.charCodeAt(pos))) pos++; // Leerraum vor der Deklaration nehmen Absender gelegentlich mit; die Upload-Prüfung lässt ihn zu

  // XML-Deklaration (nur ganz am Anfang); eine andere Kodierung als UTF-8 wird abgelehnt
  if (text.startsWith("<?xml", pos) && (isSpace(text.charCodeAt(pos + 5)) || text[pos + 5] === "?")) {
    const end = text.indexOf("?>", pos);
    if (end < 0) throw new XmlError("malformed");
    const declaration = text.slice(pos, end);
    const enc = declaration.indexOf("encoding");
    if (enc >= 0) {
      const quote = declaration.slice(enc).search(/["']/);
      if (quote < 0) throw new XmlError("malformed");
      const value = declaration.slice(enc + quote + 1, enc + quote + 1 + 16).toLowerCase();
      if (!value.startsWith("utf-8")) throw new XmlError("encoding");
    }
    pos = end + 2;
  }

  /** Offenes Element; `qname` ist der vollständige Name des Start-Tags (Abgleich mit dem End-Tag) */
  type Open = { element: XmlElement; scope: Scope; textParts: string[]; qname: string };
  const stack: Open[] = [];
  let root: XmlElement | null = null;
  let elements = 0;
  let textSize = 0;

  const rootScope: Scope = new Map([["xml", "http://www.w3.org/XML/1998/namespace"]]);

  const addText = (raw: string) => {
    textSize += raw.length;
    if (textSize > XML_LIMITS.text) throw new XmlError("tooManyNodes");
    const top = stack[stack.length - 1];
    if (!top) {
      // außerhalb der Wurzel sind nur Leerraum erlaubt
      for (let i = 0; i < raw.length; i++) if (!isSpace(raw.charCodeAt(i))) throw new XmlError("malformed");
      return;
    }
    top.textParts.push(raw);
  };

  while (pos < length) {
    const lt = text.indexOf("<", pos);
    if (lt < 0) {
      addText(decode(text.slice(pos)));
      pos = length;
      break;
    }
    if (lt > pos) addText(decode(text.slice(pos, lt)));
    pos = lt;

    if (text.startsWith("<!--", pos)) {
      const end = text.indexOf("-->", pos + 4);
      if (end < 0) throw new XmlError("malformed");
      pos = end + 3;
    } else if (text.startsWith("<![CDATA[", pos)) {
      const end = text.indexOf("]]>", pos + 9);
      if (end < 0 || stack.length === 0) throw new XmlError("malformed");
      addText(text.slice(pos + 9, end));
      pos = end + 3;
    } else if (text.startsWith("<!", pos)) {
      // <!DOCTYPE …>, <!ENTITY …>, <!ELEMENT …> und alles Ähnliche
      throw new XmlError(/^<!(DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/i.test(text.slice(pos, pos + 12)) ? "doctype" : "malformed");
    } else if (text.startsWith("<?", pos)) {
      throw new XmlError("instruction");
    } else if (text.startsWith("</", pos)) {
      const end = text.indexOf(">", pos + 2);
      if (end < 0) throw new XmlError("malformed");
      const top = stack.pop();
      if (!top) throw new XmlError("malformed");
      const closing = text.slice(pos + 2, end).trimEnd();
      if (closing.length > XML_LIMITS.name || closing !== top.qname) throw new XmlError("malformed");
      top.element.text = top.textParts.join("").trim();
      pos = end + 1;
      if (stack.length === 0) {
        // nach der Wurzel darf nichts Inhaltliches mehr folgen
        for (let i = pos; i < length; i++) {
          if (isSpace(text.charCodeAt(i))) continue;
          if (text.startsWith("<!--", i)) {
            const close = text.indexOf("-->", i + 4);
            if (close < 0) throw new XmlError("malformed");
            i = close + 2;
            continue;
          }
          throw new XmlError("malformed");
        }
        pos = length;
      }
    } else {
      // Start-Element (ggf. leer: <a/>)
      pos++;
      let i = pos;
      while (i < length && !isSpace(text.charCodeAt(i)) && text[i] !== ">" && text[i] !== "/") {
        i++;
        if (i - pos > XML_LIMITS.name) throw new XmlError("malformed");
      }
      const qname = text.slice(pos, i);
      if (!NAME.test(qname.replace(":", "_")) || qname.indexOf(":") !== qname.lastIndexOf(":")) throw new XmlError("malformed");
      if (root && stack.length === 0) throw new XmlError("malformed"); // zweite Wurzel
      elements++;
      if (elements > XML_LIMITS.elements) throw new XmlError("tooManyNodes");
      if (stack.length >= XML_LIMITS.depth) throw new XmlError("tooDeep");

      const rawAttrs: Array<[string, string]> = [];
      let selfClosing = false;
      for (;;) {
        while (i < length && isSpace(text.charCodeAt(i))) i++;
        if (i >= length) throw new XmlError("malformed");
        const c = text[i];
        if (c === ">") {
          i++;
          break;
        }
        if (c === "/") {
          if (text[i + 1] !== ">") throw new XmlError("malformed");
          selfClosing = true;
          i += 2;
          break;
        }
        const nameStart = i;
        while (i < length && !isSpace(text.charCodeAt(i)) && text[i] !== "=" && text[i] !== ">" && text[i] !== "/") {
          i++;
          if (i - nameStart > XML_LIMITS.name) throw new XmlError("malformed");
        }
        const attr = text.slice(nameStart, i);
        if (!attr || !NAME.test(attr.replace(":", "_")) || attr.indexOf(":") !== attr.lastIndexOf(":")) throw new XmlError("malformed");
        while (i < length && isSpace(text.charCodeAt(i))) i++;
        if (text[i] !== "=") throw new XmlError("malformed");
        i++;
        while (i < length && isSpace(text.charCodeAt(i))) i++;
        const quote = text[i];
        if (quote !== '"' && quote !== "'") throw new XmlError("malformed");
        const close = text.indexOf(quote, i + 1);
        if (close < 0) throw new XmlError("malformed");
        const raw = text.slice(i + 1, close);
        if (raw.includes("<")) throw new XmlError("malformed");
        if (rawAttrs.length >= XML_LIMITS.attributes) throw new XmlError("tooManyAttributes");
        if (rawAttrs.some(([existing]) => existing === attr)) throw new XmlError("malformed");
        rawAttrs.push([attr, decode(raw)]);
        i = close + 1;
        // zwischen Attributen muss Leerraum stehen
        if (i < length && !isSpace(text.charCodeAt(i)) && text[i] !== ">" && text[i] !== "/") throw new XmlError("malformed");
      }
      pos = i;

      const parentScope = stack.length > 0 ? stack[stack.length - 1].scope : rootScope;
      let scope = parentScope;
      for (const [attr, value] of rawAttrs) {
        if (attr === "xmlns" || attr.startsWith("xmlns:")) {
          if (scope === parentScope) scope = new Map(parentScope);
          scope.set(attr === "xmlns" ? "" : attr.slice(6), value);
        }
      }
      const colon = qname.indexOf(":");
      const prefix = colon < 0 ? "" : qname.slice(0, colon);
      const local = colon < 0 ? qname : qname.slice(colon + 1);
      if (prefix && !scope.has(prefix)) throw new XmlError("malformed");
      const attrs: Record<string, string> = Object.create(null);
      for (const [attr, value] of rawAttrs) if (!attr.startsWith("xmlns")) attrs[attr.includes(":") ? attr.slice(attr.indexOf(":") + 1) : attr] = value;
      const element: XmlElement = { name: local, ns: scope.get(prefix) ?? "", attrs, children: [], text: "" };
      const parent = stack[stack.length - 1];
      if (parent) parent.element.children.push(element);
      else root = element;
      if (selfClosing) {
        if (stack.length === 0) {
          for (let k = pos; k < length; k++) if (!isSpace(text.charCodeAt(k))) throw new XmlError("malformed");
          pos = length;
        }
      } else {
        stack.push({ element, scope, textParts: [], qname });
      }
    }
  }
  if (stack.length > 0 || !root) throw new XmlError(root ? "malformed" : "notXml");
  return root;
}

/** Erstes Kind mit diesem lokalen Namen. */
export const child = (element: XmlElement | null | undefined, name: string): XmlElement | null => element?.children.find((c) => c.name === name) ?? null;

/** Pfad aus lokalen Namen („A/B/C“) ab `element`. */
export function path(element: XmlElement | null | undefined, ...names: string[]): XmlElement | null {
  let current: XmlElement | null | undefined = element;
  for (const name of names) {
    current = child(current, name);
    if (!current) return null;
  }
  return current ?? null;
}

/** Alle Kinder mit diesem lokalen Namen. */
export const childrenNamed = (element: XmlElement | null | undefined, name: string): XmlElement[] => element?.children.filter((c) => c.name === name) ?? [];

/** Text des Elements am Pfad, `null` wenn es fehlt oder leer ist. */
export function textAt(element: XmlElement | null | undefined, ...names: string[]): string | null {
  const found = path(element, ...names);
  return found && found.text !== "" ? found.text : null;
}
