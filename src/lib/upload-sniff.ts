/**
 * Erkennung des tatsächlichen Dateityps anhand der ersten Bytes („Magic Bytes“) – der vom Browser gemeldete Typ (`file.type`) und die Endung sind
 * Behauptungen des Absenders. Nur Dateien, deren Inhalt zum erlaubten Typ passt, werden angenommen; **gespeichert und ausgeliefert wird der erkannte Typ**.
 * Eine HTML-Datei, die als `.png` hochgeladen wird, wird so abgelehnt, statt später im Browser als Seite ausgeführt zu werden.
 *
 * Erkannt werden PNG, JPEG, WebP, GIF, PDF, SVG (nur für das Werkstatt-Logo) und XML (vorbereitend für XRechnung/ZUGFeRD). **XML nur als elektronische Rechnung**:
 * mit XML-Deklaration, einer Wurzel aus der Positivliste (UBL `Invoice`/`CreditNote`, CII `CrossIndustryInvoice`), ohne `<!DOCTYPE`, `<!ENTITY` und `<?xml-stylesheet`
 * (externe Entitäten und Formatvorlagen sind die Angriffsfläche von XML; eine Rechnung braucht beides nie). Wer diese Dateien später **parst**, schaltet DTDs und
 * externe Entitäten im Parser trotzdem aus (Pflicht, siehe README „Uploads und Archive“).
 */

export type SniffedType = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf" | "image/svg+xml" | "application/xml";

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));

/** Anfang als Text (UTF-8 mit/ohne Byte-Order-Mark), für die Erkennung von XML/SVG. */
function textHead(bytes: Uint8Array): string {
  const start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(start, start + 2048));
}

/** Name des Wurzelelements nach XML-Deklaration, Kommentaren und DOCTYPE (ohne Namensraum-Präfix, klein geschrieben); null, wenn keines erkennbar ist. */
function xmlRoot(head: string): string | null {
  let rest = head.trimStart();
  for (;;) {
    const before = rest;
    rest = rest.replace(/^<\?xml[^>]*\?>\s*/i, "").replace(/^<!--[\s\S]*?-->\s*/, "").replace(/^<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>\s*/i, "");
    if (rest === before) break;
  }
  const m = /^<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/.exec(rest);
  return m ? m[2].toLowerCase() : null;
}

/** Wurzelelemente (klein geschrieben, ohne Namensraum-Präfix), die als XML-Beleg angenommen werden: XRechnung/ZUGFeRD in den Syntaxen UBL und CII. */
export const XML_INVOICE_ROOTS: ReadonlySet<string> = new Set(["invoice", "creditnote", "crossindustryinvoice"]);

/** Erkennt den Dateityp am Inhalt; null, wenn er zu keinem der bekannten Typen passt. */
export function sniffContentType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";

  const head = textHead(bytes);
  if (head.includes("\0")) return null;
  const root = xmlRoot(head);
  if (root === null) return null;
  if (root === "svg") return "image/svg+xml";
  // XML nur mit ausdrücklicher Deklaration, einer bekannten Rechnungs-Wurzel und ohne DTD/Entitäten/Formatvorlagen
  if (!/^\s*<\?xml/i.test(head) || !XML_INVOICE_ROOTS.has(root)) return null;
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(head)) return null;
  return "application/xml";
}

/** Verwandte Angaben zum selben Typ („text/xml“ ist „application/xml“; „image/jpg“ ist verbreitet falsch für JPEG). */
export function canonicalMime(mime: string): string {
  const m = mime.trim().toLowerCase().split(";")[0];
  if (m === "text/xml") return "application/xml";
  if (m === "image/jpg" || m === "image/pjpeg") return "image/jpeg";
  return m;
}

export type UploadCheck = { ok: true; mime: SniffedType } | { ok: false; reason: "type" | "mismatch" };

/**
 * Prüft einen Upload: Der Inhalt muss zu einem der erlaubten Typen gehören, und – wenn der Absender einen Typ angibt – dazu passen. Liefert den erkannten Typ,
 * der gespeichert wird. Eine leere Typangabe (manche Browser/Clients) ist zulässig; eine abweichende nicht.
 */
export function checkUpload(bytes: Uint8Array, declared: string, allowed: readonly string[]): UploadCheck {
  const sniffed = sniffContentType(bytes);
  if (!sniffed || !allowed.includes(sniffed)) return { ok: false, reason: "type" };
  if (declared && canonicalMime(declared) !== sniffed && canonicalMime(declared) !== "application/octet-stream") return { ok: false, reason: "mismatch" };
  return { ok: true, mime: sniffed };
}
