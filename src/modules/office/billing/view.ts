import type { Invoice, InvoiceDeduction, InvoiceItem, InvoiceSnapshot, Workshop } from "@/generated/prisma/client";
import { computeTotals, type Totals } from "@/lib/line-items";
import { dayKey } from "@/lib/zone";
import { finalizeProblems, isDraft } from "./domain";

/**
 * Das Ansichtsmodell eines Beleges: alles, was PDF, XRechnung und Detailseite zeigen – aus einer Zeile samt Positionen. Rein (ohne Datenbank).
 *
 * **Festgeschriebene Belege** lesen Absender und Empfänger aus dem **Schnappschuss** (`InvoiceSnapshot`): Profil und Kunde ändern sich danach nie rückwirkend auf dem Beleg. **Entwürfe**
 * lesen live aus dem Werkstattprofil und den Empfängerfeldern des Beleges (Vorschau; ein Entwurf ist nie verbindlich).
 */
export type SenderView = {
  name: string;
  street: string | null;
  zip: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxNumber: string | null;
  vatId: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  director: string | null;
  registerCourt: string | null;
  registerNumber: string | null;
  smallBusiness: boolean;
};
export type RecipientView = { name: string; street: string | null; zip: string | null; city: string | null; email: string | null; customerNumber: string | null };
/** Name in der Neuansicht eines Beleges, dessen Kunde anonymisiert wurde (wie der Stammsatz des Kunden) */
export const ANONYMIZED_NAME = "Anonymisiert";

/** Dieselbe Ansicht, aber ohne Namen, Anschrift und E-Mail des Empfängers (Kunde mit eingeschränkter Verarbeitung, Betrachter ohne `customers.view`); Kundennummer und Beträge bleiben. */
export const withHiddenRecipient = (view: DocView, hiddenName: string): DocView => ({ ...view, recipient: { name: hiddenName, street: null, zip: null, city: null, email: null, customerNumber: view.recipient.customerNumber } });

export type LineView = { kind: string; description: string; unit: string; quantityMilli: number; unitCents: number; taxBp: number; discountBp: number };

export type DocView = {
  id: string;
  docType: string;
  number: string;
  draft: boolean;
  /** JJJJ-MM-TT der Werkstatt-Zone */
  issueDay: string;
  dueDay: string | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  validUntil: string | null;
  sender: SenderView;
  recipient: RecipientView;
  introText: string | null;
  footerText: string | null;
  taxNote: string | null;
  buyerReference: string | null;
  paymentMethod: string;
  paymentDays: number | null;
  vehicleLabel: string | null;
  mileageKm: number | null;
  orderNumber: string | null;
  sourceNumber: string | null;
  items: LineView[];
  totals: Totals;
  exempt: boolean;
  /**
   * Angerechnete Abschläge (Schlussrechnung): je Abschlag Brutto sowie **Entgelt (netto) und darauf entfallende Umsatzsteuer je Steuersatz** – § 14 Abs. 5 Satz 2 UStG verlangt, in der Endrechnung die
   * vereinnahmten Teilentgelte **und** die darauf entfallenden Steuerbeträge abzusetzen. Die Zahlen rechnen aus den Positionen des (festgeschriebenen, unveränderlichen) Abschlags – genau wie sie dort stehen.
   */
  deductions: Array<{ number: string; issueDay: string; grossCents: number; netCents: number; vatCents: number; taxGroups: Totals["taxGroups"] }>;
  deductedCents: number;
  /** Entgelt und Umsatzsteuer aller angerechneten Abschläge (am Beleg festgeschrieben; beim Gegenbeleg einer Schlussrechnung negativ wie `deductedCents`) */
  deductedNetCents: number;
  deductedVatCents: number;
  paidCents: number;
  cancels: { number: string; issueDay: string } | null;
  finalizedAt: Date | null;
  finalizedByName: string | null;
  offerStatus: string | null;
};

export type ViewRow = Invoice & {
  items: InvoiceItem[];
  snapshot: InvoiceSnapshot | null;
  deductions: Array<InvoiceDeduction & { partial: { number: string; issueDate: Date; grossCents: number; exempt: boolean; items: Array<Pick<InvoiceItem, "quantityMilli" | "unitCents" | "taxBp" | "discountBp">> } }>;
  cancels: { number: string; issueDate: Date } | null;
  order: { number: string } | null;
  sourceDoc: { number: string } | null;
  customer: { customerNumber: string | null; /** Der Kunde wurde anonymisiert (die Neuansicht zeigt dann weder Name noch Anschrift) */ anonymizedAt?: Date | null } | null;
};

const day = (value: Date | null): string | null => (value ? dayKey(value) : null);

export function viewOf(row: ViewRow, workshop: Omit<Workshop, "logoDataUrl">): DocView {
  const snap = row.snapshot;
  const sender: SenderView = snap
    ? {
        name: snap.sName,
        street: snap.sStreet,
        zip: snap.sZip,
        city: snap.sCity,
        phone: snap.sPhone,
        email: snap.sEmail,
        website: snap.sWebsite,
        taxNumber: snap.sTaxNumber,
        vatId: snap.sVatId,
        bankName: snap.sBankName,
        iban: snap.sIban,
        bic: snap.sBic,
        director: snap.sDirector,
        registerCourt: snap.sRegisterCourt,
        registerNumber: snap.sRegisterNumber,
        smallBusiness: snap.sSmallBusiness,
      }
    : {
        name: workshop.name,
        street: workshop.street,
        zip: workshop.zip,
        city: workshop.city,
        phone: workshop.phone,
        email: workshop.email,
        website: workshop.website,
        taxNumber: workshop.taxNumber,
        vatId: workshop.vatId,
        bankName: workshop.bankName,
        iban: workshop.iban,
        bic: workshop.bic,
        director: workshop.managingDirector,
        registerCourt: workshop.registerCourt,
        registerNumber: workshop.registerNumber,
        smallBusiness: workshop.smallBusiness,
      };
  const recipient: RecipientView = snap
    ? { name: snap.rName, street: snap.rStreet, zip: snap.rZip, city: snap.rCity, email: snap.rEmail, customerNumber: snap.rCustomerNumber }
    : { name: row.partyName, street: row.partyStreet, zip: row.partyZip, city: row.partyCity, email: row.buyerEmail, customerNumber: row.customer?.customerNumber ?? null };
  const exempt = snap ? snap.sSmallBusiness : workshop.smallBusiness;
  const items: LineView[] = row.items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ kind: item.kind, description: item.description, unit: item.unit, quantityMilli: item.quantityMilli, unitCents: item.unitCents, taxBp: item.taxBp, discountBp: item.discountBp }));
  return {
    id: row.id,
    docType: row.docType,
    number: row.number,
    draft: isDraft(row),
    issueDay: dayKey(row.issueDate),
    dueDay: day(row.dueDate),
    serviceFrom: day(row.serviceFrom),
    serviceTo: day(row.serviceTo),
    validUntil: day(row.validUntil),
    sender,
    recipient,
    introText: row.introText,
    footerText: row.footerText,
    taxNote: row.taxNote,
    buyerReference: row.buyerReference,
    paymentMethod: row.paymentMethod ?? "transfer",
    paymentDays: row.paymentDays,
    vehicleLabel: row.vehicleLabel,
    mileageKm: row.mileageKm,
    orderNumber: row.order?.number ?? null,
    sourceNumber: row.sourceDoc?.number ?? null,
    items,
    totals: computeTotals(items, { exempt }),
    exempt,
    deductions: row.deductions.map((d) => {
      const parts = computeTotals(d.partial.items, { exempt: d.partial.exempt });
      return { number: d.partial.number, issueDay: dayKey(d.partial.issueDate), grossCents: d.partial.grossCents, netCents: parts.netCents, vatCents: parts.taxCents, taxGroups: parts.taxGroups };
    }),
    deductedCents: row.deductedCents,
    deductedNetCents: row.deductedNetCents,
    deductedVatCents: row.deductedVatCents,
    paidCents: row.paidCents,
    cancels: row.cancels ? { number: row.cancels.number, issueDay: dayKey(row.cancels.issueDate) } : null,
    finalizedAt: row.finalizedAt,
    finalizedByName: row.finalizedByName,
    offerStatus: row.offerStatus,
  };
}

/** Zu zahlen nach angerechneten Abschlägen (Brutto der Positionen minus Abschläge). */
export const viewPayable = (view: Pick<DocView, "totals" | "deductedCents">): number => view.totals.grossCents - view.deductedCents;

/**
 * Die Prüfliste eines Entwurfs für die Detailseite – dieselbe Regel wie beim Festschreiben (`finalizeProblems`), gerechnet aus dem Ansichtsmodell (Entwurf: live aus dem Werkstattprofil).
 * Dazu die Fälle, die nur die Operation kennt: abgelaufene Angebotsgültigkeit, geänderte Kleinunternehmer-Einstellung seit dem Anlegen, zu hohe Abschläge, eingeschränkter Kunde, nicht mehr anrechenbare Abschläge.
 */
export function draftProblems(view: DocView, row: Pick<Invoice, "exempt" | "deductedCents">, today: string, extra: { restricted?: boolean; invalidDeductions?: number } = {}): string[] {
  const problems = finalizeProblems({
    docType: view.docType,
    sender: { name: view.sender.name, street: view.sender.street, zip: view.sender.zip, city: view.sender.city, taxNumber: view.sender.taxNumber, vatId: view.sender.vatId, iban: view.sender.iban, smallBusiness: view.sender.smallBusiness },
    recipient: { name: view.recipient.name, street: view.recipient.street, zip: view.recipient.zip, city: view.recipient.city },
    serviceFrom: view.serviceFrom,
    serviceTo: view.serviceTo,
    validUntil: view.validUntil,
    paymentDays: view.paymentDays,
    paymentMethod: view.paymentMethod,
    itemCount: view.items.length,
    taxRates: [...new Set(view.items.map((item) => item.taxBp))],
    taxNote: view.taxNote,
    exceedsLimit: view.totals.exceedsLimit,
    grossCents: view.totals.grossCents,
  });
  if (view.docType === "offer" && view.validUntil && view.validUntil < today) problems.push("validUntilPast");
  if (row.exempt !== view.exempt) problems.push("exemptChanged");
  if (view.docType === "final" && row.deductedCents > view.totals.grossCents) problems.push("deductionTooHigh");
  // Fälle, die nur die Datenbank kennt: Kunde inzwischen eingeschränkt/anonymisiert (Art. 18); ein gewählter Abschlag ist nicht mehr anrechenbar (storniert, anderswo angerechnet)
  if (extra.restricted) problems.push("restricted");
  if (extra.invalidDeductions) problems.push("deduction");
  return problems;
}
