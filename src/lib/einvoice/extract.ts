import { XmlError, child, childrenNamed, parseXml, path, textAt, type XmlElement } from "./xml";

/**
 * Liest aus einer elektronischen Rechnung (XRechnung/ZUGFeRD-XML) die Angaben, die das Formular „Eingangsrechnung“ kennt, **als Vorschlag**: Nummer, Datum, Fälligkeit,
 * Lieferant, Netto, MwSt., Brutto. Nichts wird gespeichert oder übernommen – die Person sieht den Vorschlag und entscheidet. Das Original bleibt als Beleg unverändert.
 *
 * Unterstützt werden UBL (`Invoice`, `CreditNote`) und CII (`CrossIndustryInvoice`), erkannt an Wurzelname **und** Namensraum (dieselbe Positivliste wie die Upload-Prüfung,
 * `upload-sniff.ts`). Gelesen wird nur mit dem schmalen, entitätsfreien Leser aus `xml.ts`.
 */

export type EInvoiceSyntax = "ubl" | "cii";
export type EInvoiceWarning = "currency" | "sum" | "missing";

export type EInvoiceProposal = {
  syntax: EInvoiceSyntax;
  /** Gutschrift: Beträge stehen dann negativ im Vorschlag */
  creditNote: boolean;
  number: string | null;
  /** `JJJJ-MM-TT` */
  issueDate: string | null;
  dueDate: string | null;
  /** Rechnungssteller (der Lieferant einer Eingangsrechnung) */
  seller: string | null;
  buyer: string | null;
  currency: string | null;
  netCents: number | null;
  vatCents: number | null;
  grossCents: number | null;
  warnings: EInvoiceWarning[];
};

const NS_UBL_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const NS_UBL_CREDIT = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
const NS_CII = "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100";

/** Dezimalzahl mit Punkt (`1234.56`, `-12.5`, `100`) → ganze Cent, kaufmännisch gerundet (ab der dritten Nachkommastelle); `null`, wenn es keine einfache Dezimalzahl ist. */
export function decimalToCents(text: string | null | undefined): number | null {
  if (text == null) return null;
  const m = /^([+-]?)(\d{1,12})(?:\.(\d{1,12}))?$/.exec(text.trim());
  if (!m) return null;
  const [, sign, whole, fraction = ""] = m;
  const digits = (fraction + "00").slice(0, 2);
  let cents = Number(whole) * 100 + Number(digits);
  if (fraction.length > 2 && fraction.charCodeAt(2) >= 0x35) cents += 1; // 5 und mehr rundet auf
  return sign === "-" ? 0 - cents : cents;
}

/** `JJJJ-MM-TT` oder `JJJJMMTT` (CII Format 102) → `JJJJ-MM-TT`, nur echte Kalendertage. */
export function einvoiceDay(text: string | null | undefined, format?: string): string | null {
  if (!text) return null;
  const value = text.trim();
  let y: string, mo: string, d: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:Z|[+-]\d{2}:\d{2})?$/.exec(value);
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (iso) [, y, mo, d] = iso;
  else if (compact && (format === undefined || format === "102")) [, y, mo, d] = compact;
  else return null;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d) ? `${y}-${mo}-${d}` : null;
}

const clip = (value: string | null, max = 120): string | null => (value ? value.slice(0, max) : null);

type Raw = Omit<EInvoiceProposal, "warnings" | "netCents" | "vatCents" | "grossCents"> & { net: number | null; vat: number | null; gross: number | null };

function finish(raw: Raw): EInvoiceProposal {
  const sign = raw.creditNote ? -1 : 1;
  const signed = (v: number | null) => (v == null ? null : v === 0 ? 0 : v * sign);
  let { net, vat } = raw;
  const { gross } = raw;
  const warnings: EInvoiceWarning[] = [];
  if (vat == null && net != null && gross != null) vat = gross - net; // nur Netto und Brutto genannt: die Steuer ist die Differenz
  if (net == null && vat != null && gross != null) net = gross - vat;
  if (raw.currency && raw.currency !== "EUR") warnings.push("currency");
  if (net != null && vat != null && gross != null && Math.abs(net + vat - gross) > 1) warnings.push("sum");
  if (!raw.number || !raw.issueDate || gross == null || !raw.seller) warnings.push("missing");
  return {
    syntax: raw.syntax,
    creditNote: raw.creditNote,
    number: raw.number,
    issueDate: raw.issueDate,
    dueDate: raw.dueDate,
    seller: raw.seller,
    buyer: raw.buyer,
    currency: raw.currency,
    netCents: signed(net),
    vatCents: signed(vat),
    grossCents: signed(gross),
    warnings,
  };
}

/** Betrag am Pfad, bevorzugt in der Dokumentwährung (UBL/CII führen die Steuer teils zusätzlich in der Buchhaltungswährung). */
function amountIn(elements: XmlElement[], currency: string | null): number | null {
  const preferred = elements.find((e) => (e.attrs.currencyID ?? currency) === currency) ?? elements[0];
  return decimalToCents(preferred?.text);
}

function readUbl(root: XmlElement, creditNote: boolean): EInvoiceProposal {
  const currency = clip(textAt(root, "DocumentCurrencyCode"), 3);
  const party = (side: string) =>
    clip(textAt(root, side, "Party", "PartyLegalEntity", "RegistrationName") ?? textAt(root, side, "Party", "PartyName", "Name"));
  const totals = child(root, "LegalMonetaryTotal");
  const taxTotals = childrenNamed(root, "TaxTotal").map((t) => child(t, "TaxAmount")).filter((e): e is XmlElement => !!e);
  const typeCode = textAt(root, "InvoiceTypeCode");
  return finish({
    syntax: "ubl",
    creditNote: creditNote || typeCode === "381",
    number: clip(textAt(root, "ID"), 60),
    issueDate: einvoiceDay(textAt(root, "IssueDate")),
    dueDate: einvoiceDay(textAt(root, "DueDate") ?? textAt(root, "PaymentMeans", "PaymentDueDate")),
    seller: party("AccountingSupplierParty"),
    buyer: party("AccountingCustomerParty"),
    currency,
    net: decimalToCents(textAt(totals, "TaxExclusiveAmount")),
    vat: taxTotals.length > 0 ? amountIn(taxTotals, currency) : null,
    gross: decimalToCents(textAt(totals, "TaxInclusiveAmount") ?? textAt(totals, "PayableAmount")),
  });
}

function readCii(root: XmlElement): EInvoiceProposal {
  const document = child(root, "ExchangedDocument");
  const transaction = child(root, "SupplyChainTradeTransaction");
  const agreement = child(transaction, "ApplicableHeaderTradeAgreement");
  const settlement = child(transaction, "ApplicableHeaderTradeSettlement");
  const sum = child(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
  const currency = clip(textAt(settlement, "InvoiceCurrencyCode"), 3);
  const issued = path(document, "IssueDateTime", "DateTimeString");
  const due = path(settlement, "SpecifiedTradePaymentTerms", "DueDateDateTime", "DateTimeString");
  return finish({
    syntax: "cii",
    creditNote: textAt(document, "TypeCode") === "381",
    number: clip(textAt(document, "ID"), 60),
    issueDate: einvoiceDay(issued?.text, issued?.attrs.format),
    dueDate: einvoiceDay(due?.text, due?.attrs.format),
    seller: clip(textAt(agreement, "SellerTradeParty", "Name")),
    buyer: clip(textAt(agreement, "BuyerTradeParty", "Name")),
    currency,
    net: decimalToCents(textAt(sum, "TaxBasisTotalAmount")),
    vat: childrenNamed(sum, "TaxTotalAmount").length > 0 ? amountIn(childrenNamed(sum, "TaxTotalAmount"), currency) : null,
    gross: decimalToCents(textAt(sum, "GrandTotalAmount") ?? textAt(sum, "DuePayableAmount")),
  });
}

export type EInvoiceResult = { ok: true; proposal: EInvoiceProposal } | { ok: false; error: XmlError["code"] | "unsupported" };

/** Liest eine E-Rechnung (UBL oder CII) aus den Bytes der Datei. Wirft nie: Fehler kommen als Code. */
export function readEInvoice(bytes: Uint8Array): EInvoiceResult {
  let root: XmlElement;
  try {
    root = parseXml(bytes);
  } catch (error) {
    if (error instanceof XmlError) return { ok: false, error: error.code };
    throw error;
  }
  if (root.name === "Invoice" && root.ns === NS_UBL_INVOICE) return { ok: true, proposal: readUbl(root, false) };
  if (root.name === "CreditNote" && root.ns === NS_UBL_CREDIT) return { ok: true, proposal: readUbl(root, true) };
  if (root.name === "CrossIndustryInvoice" && root.ns === NS_CII) return { ok: true, proposal: readCii(root) };
  return { ok: false, error: "unsupported" };
}
