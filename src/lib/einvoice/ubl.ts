import { computeTotals, lineResult, type ParsedLine } from "@/lib/line-items";

/**
 * E-Rechnung schreiben (F3): **XRechnung 3.0 in der Syntax UBL 2.1** (`Invoice` für Rechnung, Abschlags- und Schlussrechnung, `CreditNote` für Stornorechnung/Gutschrift).
 *
 * **Warum UBL:** Die Elementreihenfolge des UBL-Schemas ist fest und gut dokumentiert (Folge von Elementen statt der tief verschachtelten Handelsabwicklung von CII), der Leser der Anwendung
 * (`extract.ts`) kennt UBL und CII, und die Prüfkonfiguration der KoSIT (`scripts/validate-xrechnung.sh`, XRechnung 3.0.2) enthält Szenarien für UBL-Rechnung und UBL-Gutschrift.
 * ZUGFeRD/PDF-A3 ist nicht Teil des Releases (siehe README „PDF-Erzeugung“): das XML wird getrennt geliefert.
 *
 * Reine Funktion ohne Datenbank: Aus den Angaben des Beleges entsteht ein Text. **Jeder Wert wird maskiert** (`xmlText`: &, <, >, Anführungszeichen, ungültige XML-Zeichen entfallen) – es gibt keine
 * Verkettung ohne Maskierung. Beträge rechnet `computeTotals` (dieselbe Regel wie Editor, Server und PDF): Steuer je Satz auf der Summe gerundet, Rabatt je Position als Nachlass der Position.
 *
 * **Vorzeichen:** Intern sind Gutschriften negativ (negative Mengen). In der UBL-Gutschrift stehen die Beträge positiv (Dokumenttyp 381 macht die Richtung); der Schreiber kehrt sie um. Ein negativer
 * Einzelpreis ist in EN 16931 verboten (BR-27): er wandert in die Menge.
 *
 * **Verkäuferkennung (BR-CO-26, BR-S-02/BR-E-02):** USt-IdNr. → BT-31 (`PartyTaxScheme`/`VAT`), Steuernummer → BT-32 (`PartyTaxScheme`/`FC`, auch neben der USt-IdNr.), Registernummer → BT-30
 * (`PartyLegalEntity/CompanyID`). Eine Steuernummer allein genügt BR-CO-26 nicht (verlangt BT-29, BT-30 und/oder BT-31): Hat der Verkäufer weder USt-IdNr. noch Registernummer (Kleinunternehmer),
 * steht die Steuernummer zusätzlich als Kennung des Verkäufers (BT-29, `PartyIdentification/ID`).
 *
 * **Zahlungsbedingung (BR-CO-25):** Ist der Zahlbetrag positiv, braucht jede E-Rechnung Fälligkeit (BT-9) oder Zahlungsbedingungen (BT-20). Rechnungen tragen die Fälligkeit; Gutschriften
 * (Stornorechnungen) einen Text als Zahlungsbedingung – ein erfundenes Fälligkeitsdatum wäre eine Zahlungsaufforderung, die es nicht gibt.
 *
 * `einvoiceProblems` nennt vorab, was für eine gültige XRechnung fehlt (Pflichtangaben der Xrechnung: Käuferreferenz, Kontakt des Verkäufers, elektronische Adressen, Steuerkennzeichen …).
 */

export const CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
export const PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
export const SMALL_BUSINESS_NOTE = "Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.";

export type EinvoiceType = "invoice" | "partial" | "credit";
export type EinvoiceParty = {
  name: string;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  /** USt-IdNr. mit Länderkennung (DE123456789) */
  vatId?: string | null;
  taxNumber?: string | null;
  registerNumber?: string | null;
};
export type EinvoiceLine = ParsedLine & { description: string; unit: string };
export type EinvoicePayment = { method: "transfer" | "cash" | "card" | "other"; iban?: string | null; bic?: string | null; accountHolder?: string | null; reference: string };

export type EinvoiceInput = {
  type: EinvoiceType;
  number: string;
  /** JJJJ-MM-TT */
  issueDate: string;
  dueDate: string | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  buyerReference: string;
  /** Auftragsnummer (BT-13), wenn der Beleg zu einem Auftrag gehört */
  orderNumber?: string | null;
  seller: EinvoiceParty;
  buyer: EinvoiceParty;
  smallBusiness: boolean;
  /** Grund der Steuerbefreiung für Positionen mit 0 % (nicht Kleinunternehmer) */
  taxNote: string | null;
  lines: readonly EinvoiceLine[];
  payment: EinvoicePayment;
  /** Text der Zahlungsbedingungen (BT-20) */
  paymentTerms: string | null;
  /** angerechnete Abschläge (Schlussrechnung): Summe brutto und die Rechnungen, auf die verwiesen wird */
  prepaid: {
    cents: number;
    refs: ReadonlyArray<{ number: string; issueDate: string }>;
    /** Anmerkungen (BT-22) zur Anrechnung: Entgelt und darauf entfallende Steuer je Abschlag (§ 14 Abs. 5 UStG) */
    notes?: readonly string[];
  };
  /** Gegenbeleg: die stornierte Rechnung (BT-25) */
  creditOf?: { number: string; issueDate: string } | null;
};

export class EinvoiceError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`E-Rechnung unvollständig: ${problems.join(", ")}`);
    this.name = "EinvoiceError";
  }
}

/** Zeichen, die XML 1.0 nicht kennt (Steuerzeichen außer Tabulator/Zeilenumbruch, einzelne Surrogate, U+FFFE/U+FFFF). */
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Text für ein Element oder Attribut: ungültige Zeichen entfallen, die fünf Sonderzeichen werden maskiert. */
export function xmlText(value: string): string {
  return value
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Einzeiliger Text (Namen, Bezeichnungen): Umbrüche und Mehrfach-Leerraum werden zu einem Leerzeichen. */
const oneLine = (value: string, max = 500): string => value.replace(/\s+/g, " ").trim().slice(0, max);

/** Cent → Dezimalzahl mit Punkt und zwei Stellen („-12.30“). */
export function decimalCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Menge/Prozent in Tausendsteln bzw. Hundertsteln → Dezimalzahl ohne überflüssige Nullen („1.5“, „19“). */
function scaled(value: number, decimals: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const factor = 10 ** decimals;
  const fraction = String(abs % factor).padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${Math.trunc(abs / factor)}${fraction ? `.${fraction}` : ""}`;
}

/** UN/ECE-Einheit (Rec. 20) zu den üblichen Einheiten der Werkstatt; alles andere ist „Stück“ (C62). */
export function unitCode(unit: string): string {
  const key = unit.trim().toLowerCase().replace(/\./g, "");
  const map: Record<string, string> = {
    "": "C62", stk: "C62", stück: "C62", st: "C62", x: "C62", pcs: "C62",
    h: "HUR", std: "HUR", stunde: "HUR", stunden: "HUR",
    min: "MIN",
    l: "LTR", liter: "LTR", ltr: "LTR",
    kg: "KGM", g: "GRM", t: "TNE",
    m: "MTR", cm: "CMT", mm: "MMT", km: "KMT",
    "m²": "MTK", qm: "MTK", "m³": "MTQ",
    tag: "DAY", tage: "DAY", d: "DAY",
    pauschal: "C62", psch: "C62", satz: "SET", set: "SET",
  };
  return map[key] ?? "C62";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Was für eine gültige XRechnung noch fehlt (Codes; die Oberfläche übersetzt sie als `billing.xrechnung.problems.<code>`). Leer = vollständig.
 */
export function einvoiceProblems(input: EinvoiceInput): string[] {
  const out: string[] = [];
  const missing = (value: string | null | undefined) => !value || !value.trim();
  if (missing(input.number)) out.push("number");
  if (!DAY.test(input.issueDate)) out.push("issueDate");
  if (missing(input.buyerReference)) out.push("buyerReference");
  const seller = input.seller;
  if (missing(seller.name)) out.push("sellerName");
  if (missing(seller.street)) out.push("sellerStreet");
  if (missing(seller.zip)) out.push("sellerZip");
  if (missing(seller.city)) out.push("sellerCity");
  if (missing(seller.vatId) && missing(seller.taxNumber)) out.push("sellerTaxId");
  if (missing(seller.phone)) out.push("sellerPhone");
  if (missing(seller.email)) out.push("sellerEmail");
  const buyer = input.buyer;
  if (missing(buyer.name)) out.push("buyerName");
  if (missing(buyer.street)) out.push("buyerStreet");
  if (missing(buyer.zip)) out.push("buyerZip");
  if (missing(buyer.city)) out.push("buyerCity");
  if (missing(buyer.email)) out.push("buyerEmail");
  if (input.lines.length === 0) out.push("noLines");
  if (input.payment.method === "transfer" && missing(input.payment.iban)) out.push("iban");
  if (!input.smallBusiness && input.lines.some((line) => line.taxBp === 0) && missing(input.taxNote)) out.push("taxNote");
  const totals = computeTotals(input.lines, { exempt: input.smallBusiness });
  if (totals.exceedsLimit) out.push("tooLarge");
  if (input.prepaid.cents < 0 || input.prepaid.cents > Math.max(0, Math.abs(totals.grossCents))) out.push("prepaid");
  // BR-CO-25: ein positiver Zahlbetrag braucht Fälligkeit oder Zahlungsbedingungen
  const payable = Math.abs(totals.grossCents) - input.prepaid.cents;
  if (payable > 0 && !input.dueDate && missing(input.paymentTerms)) out.push("paymentTerms");
  return out;
}

/** Positionen in die Form der E-Rechnung: positiver Einzelpreis (BR-27), Gutschrift mit positiven Beträgen. */
function normalizeLine(line: EinvoiceLine, credit: boolean): EinvoiceLine {
  let { quantityMilli, unitCents } = line;
  if (unitCents < 0) {
    quantityMilli = -quantityMilli;
    unitCents = -unitCents;
  }
  if (credit) quantityMilli = -quantityMilli;
  return { ...line, quantityMilli, unitCents };
}

type Tag = string;
const el = (name: string, content: string | readonly Tag[], attrs: Record<string, string> = {}): Tag => {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${xmlText(v)}"`).join("");
  const body = typeof content === "string" ? xmlText(content) : content.join("");
  return `<${name}${a}>${body}</${name}>`;
};
const amount = (name: string, cents: number): Tag => el(name, decimalCents(cents), { currencyID: "EUR" });
const optional = (name: string, value: string | null | undefined): Tag[] => (value && value.trim() ? [el(name, oneLine(value))] : []);

function party(p: EinvoiceParty, side: "seller" | "buyer"): Tag {
  const taxSchemes: Tag[] = [];
  if (side === "seller") {
    if (p.vatId?.trim()) taxSchemes.push(el("cac:PartyTaxScheme", [el("cbc:CompanyID", oneLine(p.vatId)), el("cac:TaxScheme", [el("cbc:ID", "VAT")])]));
    if (p.taxNumber?.trim()) taxSchemes.push(el("cac:PartyTaxScheme", [el("cbc:CompanyID", oneLine(p.taxNumber)), el("cac:TaxScheme", [el("cbc:ID", "FC")])]));
  }
  // BT-29: Ohne USt-IdNr. und ohne Registernummer wäre der Verkäufer nach BR-CO-26 nicht kenntlich – dann dient die Steuernummer als Kennung
  const identification =
    side === "seller" && !p.vatId?.trim() && !p.registerNumber?.trim() && p.taxNumber?.trim() ? [el("cac:PartyIdentification", [el("cbc:ID", oneLine(p.taxNumber))])] : [];
  const legal = [el("cbc:RegistrationName", oneLine(p.name)), ...(side === "seller" ? optional("cbc:CompanyID", p.registerNumber) : [])];
  const contact =
    side === "seller" ? [el("cac:Contact", [el("cbc:Name", oneLine(p.contactName || p.name)), ...optional("cbc:Telephone", p.phone), ...optional("cbc:ElectronicMail", p.email)])] : [];
  return el("cac:Party", [
    ...(p.email?.trim() ? [el("cbc:EndpointID", oneLine(p.email), { schemeID: "EM" })] : []),
    ...identification,
    el("cac:PartyName", [el("cbc:Name", oneLine(p.name))]),
    el("cac:PostalAddress", [...optional("cbc:StreetName", p.street), ...optional("cbc:CityName", p.city), ...optional("cbc:PostalZone", p.zip), el("cac:Country", [el("cbc:IdentificationCode", "DE")])]),
    ...taxSchemes,
    el("cac:PartyLegalEntity", legal),
    ...contact,
  ]);
}

/** Steuerkategorie einer Gruppe: Kleinunternehmer und Satz 0 % = „E“ (befreit, mit Grund), sonst „S“ (Normalsatz oder ermäßigt). */
const category = (taxBp: number, exempt: boolean): "E" | "S" => (exempt || taxBp === 0 ? "E" : "S");

const PAYMENT_CODE = { transfer: "58", cash: "10", card: "1", other: "1" } as const;

/** Die XRechnung als UBL-Text. Wirft `EinvoiceError`, wenn Pflichtangaben fehlen. */
export function buildUblXml(input: EinvoiceInput): string {
  const problems = einvoiceProblems(input);
  if (problems.length > 0) throw new EinvoiceError(problems);
  const credit = input.type === "credit";
  const lines = input.lines.map((line) => normalizeLine(line, credit));
  const totals = computeTotals(lines, { exempt: input.smallBusiness });
  const payable = totals.grossCents - input.prepaid.cents;
  const reason = input.smallBusiness ? SMALL_BUSINESS_NOTE : (input.taxNote ?? "").trim();
  const typeCode = credit ? "381" : input.type === "partial" ? "326" : "380";

  const header: Tag[] = [
    el("cbc:CustomizationID", CUSTOMIZATION_ID),
    el("cbc:ProfileID", PROFILE_ID),
    el("cbc:ID", oneLine(input.number, 60)),
    el("cbc:IssueDate", input.issueDate),
    ...(!credit && input.dueDate ? [el("cbc:DueDate", input.dueDate)] : []),
    el(credit ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode", typeCode),
    ...(input.prepaid.notes ?? []).map((note) => el("cbc:Note", oneLine(note, 1000))),
    el("cbc:DocumentCurrencyCode", "EUR"),
    el("cbc:BuyerReference", oneLine(input.buyerReference)),
  ];
  // Leistungszeitraum (BT-73/74) bei zwei verschiedenen Tagen, sonst Lieferdatum (BT-72)
  const period = input.serviceFrom && input.serviceTo && input.serviceTo !== input.serviceFrom;
  if (period) header.push(el("cac:InvoicePeriod", [el("cbc:StartDate", input.serviceFrom!), el("cbc:EndDate", input.serviceTo!)]));
  if (input.orderNumber?.trim()) header.push(el("cac:OrderReference", [el("cbc:ID", oneLine(input.orderNumber, 60))]));
  const billingRefs = credit && input.creditOf ? [input.creditOf] : input.prepaid.refs;
  for (const ref of billingRefs) header.push(el("cac:BillingReference", [el("cac:InvoiceDocumentReference", [el("cbc:ID", oneLine(ref.number, 60)), el("cbc:IssueDate", ref.issueDate)])]));

  const parties = [el("cac:AccountingSupplierParty", [party(input.seller, "seller")]), el("cac:AccountingCustomerParty", [party(input.buyer, "buyer")])];
  const delivery = !period && input.serviceFrom ? [el("cac:Delivery", [el("cbc:ActualDeliveryDate", input.serviceFrom)])] : [];

  const pay = input.payment;
  const means = el("cac:PaymentMeans", [
    el("cbc:PaymentMeansCode", PAYMENT_CODE[pay.method]),
    ...(credit && input.dueDate ? [el("cbc:PaymentDueDate", input.dueDate)] : []),
    ...(input.payment.reference.trim() ? [el("cbc:PaymentID", oneLine(input.payment.reference, 140))] : []),
    ...(pay.method === "transfer" && pay.iban
      ? [el("cac:PayeeFinancialAccount", [el("cbc:ID", pay.iban.replace(/\s+/g, "")), ...optional("cbc:Name", pay.accountHolder), ...(pay.bic?.trim() ? [el("cac:FinancialInstitutionBranch", [el("cbc:ID", pay.bic.replace(/\s+/g, ""))])] : [])])]
      : []),
  ]);
  const terms = input.paymentTerms?.trim() ? [el("cac:PaymentTerms", [el("cbc:Note", oneLine(input.paymentTerms, 1000))])] : [];

  const taxTotal = el("cac:TaxTotal", [
    amount("cbc:TaxAmount", totals.taxCents),
    ...totals.taxGroups.map((group) =>
      el("cac:TaxSubtotal", [
        amount("cbc:TaxableAmount", group.netCents),
        amount("cbc:TaxAmount", group.taxCents),
        el("cac:TaxCategory", [
          el("cbc:ID", category(group.taxBp, input.smallBusiness)),
          el("cbc:Percent", scaled(group.taxBp, 2)),
          ...(category(group.taxBp, input.smallBusiness) === "E" ? [el("cbc:TaxExemptionReason", oneLine(reason, 500))] : []),
          el("cac:TaxScheme", [el("cbc:ID", "VAT")]),
        ]),
      ]),
    ),
  ]);
  const monetary = el("cac:LegalMonetaryTotal", [
    amount("cbc:LineExtensionAmount", totals.netCents),
    amount("cbc:TaxExclusiveAmount", totals.netCents),
    amount("cbc:TaxInclusiveAmount", totals.grossCents),
    ...(input.prepaid.cents > 0 ? [amount("cbc:PrepaidAmount", input.prepaid.cents)] : []),
    amount("cbc:PayableAmount", payable),
  ]);

  const lineName = credit ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const quantityName = credit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";
  const lineTags = lines.map((line, index) => {
    const result = lineResult(line);
    const cat = category(input.smallBusiness ? 0 : line.taxBp, input.smallBusiness);
    return el(lineName, [
      el("cbc:ID", String(index + 1)),
      el(quantityName, scaled(line.quantityMilli, 3), { unitCode: unitCode(line.unit) }),
      amount("cbc:LineExtensionAmount", result.netCents),
      // Rabatt als Nachlass; bei negativer Menge (Korrekturposition) ist der „Rabatt“ rechnerisch ein Aufschlag – Beträge sind in EN 16931 nie negativ
      ...(result.discountCents > 0
        ? [el("cac:AllowanceCharge", [el("cbc:ChargeIndicator", "false"), el("cbc:AllowanceChargeReasonCode", "95"), el("cbc:AllowanceChargeReason", "Rabatt"), amount("cbc:Amount", result.discountCents)])]
        : result.discountCents < 0
          ? [el("cac:AllowanceCharge", [el("cbc:ChargeIndicator", "true"), el("cbc:AllowanceChargeReason", "Rabatt (Korrekturposition)"), amount("cbc:Amount", 0 - result.discountCents)])]
          : []),
      el("cac:Item", [
        el("cbc:Name", oneLine(line.description, 200) || "-"),
        el("cac:ClassifiedTaxCategory", [el("cbc:ID", cat), el("cbc:Percent", scaled(input.smallBusiness ? 0 : line.taxBp, 2)), el("cac:TaxScheme", [el("cbc:ID", "VAT")])]),
      ]),
      el("cac:Price", [amount("cbc:PriceAmount", line.unitCents)]),
    ]);
  });

  const root = credit ? "CreditNote" : "Invoice";
  const ns = `urn:oasis:names:specification:ubl:schema:xsd:${root}-2`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">` +
    [...header, ...parties, ...delivery, means, ...terms, taxTotal, monetary, ...lineTags].join("") +
    `</${root}>\n`
  );
}
