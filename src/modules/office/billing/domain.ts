import { addDaysToKey, dayKey, startOfDay } from "@/lib/zone";
import { safeName } from "@/lib/filename";
import { formatCents } from "@/lib/money";
import { sanitizeSubject } from "@/lib/mail";
import { ALLOWED_TAX_BP, isInvoiceType, isQuoteType, SMALL_AMOUNT_GROSS_CENTS } from "./constants";

/**
 * Fachlogik der Rechnungserstellung (F3), rein und ohne Datenbank: Zustände, Nummernkreise, Prüfliste vor dem Festschreiben, Zahlstatus, Texte des Versands.
 * Die Operationen (`operations.ts`) rufen diese Funktionen auf; die Oberfläche benutzt dieselben für Anzeigen und Knöpfe.
 */

export { numberSlot, renderNumber, type NumberSlot } from "@/lib/invoice-numbering";

/* ───────────── Zustände ───────────── */

type DocLike = { source: string; finalizedAt: Date | null };
/** Ein Entwurf ist ein Beleg der Rechnungserstellung, der noch nicht festgeschrieben bzw. ausgestellt wurde (er hat noch keine Nummer). */
export const isDraft = (d: DocLike): boolean => d.source === "billing" && d.finalizedAt === null;

export type OfferState = "open" | "accepted" | "rejected" | "expired";
/** Zustand eines ausgestellten Angebots; „abgelaufen“ ist ein offenes Angebot, dessen Gültigkeit vor heute endete. */
export function offerState(d: { offerStatus: string | null; validUntil: Date | null }, now = new Date()): OfferState {
  if (d.offerStatus === "accepted") return "accepted";
  if (d.offerStatus === "rejected") return "rejected";
  return d.validUntil && startOfDay(d.validUntil) < startOfDay(now) ? "expired" : "open";
}

export type BillingPaymentState = "open" | "partial" | "overdue" | "paid" | "cancelled";
type PayLike = { status: string; dueDate: Date | null; grossCents: number; deductedCents: number; paidCents: number };

/** Zu zahlen: Brutto abzüglich angerechneter Abschläge (Schlussrechnung). */
export const payableCents = (d: Pick<PayLike, "grossCents" | "deductedCents">): number => d.grossCents - d.deductedCents;
/** Noch offen: zu zahlen abzüglich der bisherigen Zahlungen (nie negativ). */
export const remainingCents = (d: Pick<PayLike, "grossCents" | "deductedCents" | "paidCents">): number => Math.max(0, payableCents(d) - d.paidCents);

/** Zahlstatus eines Buchungsbelegs: bezahlt, teilweise bezahlt, überfällig, offen oder storniert. */
export function billingPaymentState(d: PayLike, now = new Date()): BillingPaymentState {
  if (d.status === "cancelled") return "cancelled";
  if (d.status === "paid") return "paid";
  if (d.paidCents > 0 && d.paidCents < payableCents(d)) return d.dueDate && startOfDay(d.dueDate) < startOfDay(now) ? "overdue" : "partial";
  return d.dueDate && startOfDay(d.dueDate) < startOfDay(now) ? "overdue" : "open";
}

/** Status und Zahlungsdatum nach einer Änderung der Zahlungen: bezahlt, sobald nichts mehr offen ist (und mindestens ein Betrag eingegangen ist). */
export function statusAfterPayments(d: Pick<PayLike, "grossCents" | "deductedCents">, paidCents: number): "open" | "paid" {
  return paidCents > 0 && paidCents >= payableCents(d) ? "paid" : "open";
}

/* ───────────── Prüfliste vor dem Festschreiben ───────────── */

export type SenderProfile = { name: string; street: string | null; zip: string | null; city: string | null; taxNumber: string | null; vatId: string | null; iban: string | null; smallBusiness: boolean };
export type RecipientProfile = { name: string; street: string | null; zip: string | null; city: string | null };

export type FinalizeCheckInput = {
  docType: string;
  sender: SenderProfile;
  recipient: RecipientProfile;
  /** JJJJ-MM-TT */
  serviceFrom: string | null;
  serviceTo: string | null;
  validUntil: string | null;
  paymentDays: number | null;
  paymentMethod: string;
  itemCount: number;
  /** die verwendeten Steuersätze in Basispunkten (ohne Kleinunternehmer-Zeilen: dort ist alles 0) */
  taxRates: readonly number[];
  taxNote: string | null;
  exceedsLimit: boolean;
};

const blank = (value: string | null | undefined): boolean => !value || !value.trim();

/**
 * Pflichtangaben vor dem Festschreiben (§ 14 UStG, soweit die Anwendung sie prüfen kann): Name und Anschrift von Absender und Empfänger, Steuernummer oder USt-IdNr., Leistungsdatum oder
 * -zeitraum, mindestens eine Position mit zulässigem Steuersatz, Zahlungsziel, Bankverbindung bei Überweisung. Die fortlaufende Nummer vergibt das Festschreiben selbst. Die Codes erscheinen als
 * ruhige Liste (`billing.problems.<code>`); Leer = darf festgeschrieben werden. Für Angebote und Auftragsbestätigungen gilt eine kürzere Liste (keine Steuer-/Zahlungsangaben).
 * Die **Kleinbetragsrechnung** (bis 250 € brutto) ist hier nur ein Hinweis (`isSmallAmount`), keine Sonderregel.
 */
export function finalizeProblems(input: FinalizeCheckInput): string[] {
  const out: string[] = [];
  const { sender, recipient } = input;
  if (blank(sender.name)) out.push("senderName");
  if (blank(sender.street) || blank(sender.zip) || blank(sender.city)) out.push("senderAddress");
  if (blank(recipient.name)) out.push("recipientName");
  if (blank(recipient.street) || blank(recipient.zip) || blank(recipient.city)) out.push("recipientAddress");
  if (input.itemCount === 0) out.push("noItems");
  if (input.exceedsLimit) out.push("tooLarge");
  if (isQuoteType(input.docType)) {
    if (input.docType === "offer" && !input.validUntil) out.push("validUntil");
    return out;
  }
  if (blank(sender.taxNumber) && blank(sender.vatId)) out.push("senderTaxId");
  if (!input.serviceFrom) out.push("serviceDate");
  else if (input.serviceTo && input.serviceTo < input.serviceFrom) out.push("serviceRange");
  if (input.paymentDays === null || input.paymentDays < 0) out.push("paymentDays");
  if (input.paymentMethod === "transfer" && blank(sender.iban)) out.push("iban");
  if (!sender.smallBusiness) {
    if (input.taxRates.some((rate) => !(ALLOWED_TAX_BP as readonly number[]).includes(rate))) out.push("taxRate");
    if (input.taxRates.includes(0) && blank(input.taxNote)) out.push("taxNote");
  }
  return out;
}

/** Kleinbetragsrechnung (§ 33 UStDV): bis 250 € brutto. Nur ein Hinweis. */
export const isSmallAmount = (grossCents: number): boolean => Math.abs(grossCents) <= SMALL_AMOUNT_GROSS_CENTS;

/** Fälligkeit aus Rechnungsdatum und Zahlungsziel (Tage). */
export const dueDayKey = (issueKey: string, paymentDays: number): string => addDaysToKey(issueKey, paymentDays);

/* ───────────── Datei- und Anzeigenamen, Texte ───────────── */

/** Bezeichnung der Belegart im Dokument (deutsch; Dokumente werden auf Deutsch ausgestellt). */
export const DOC_TITLE: Record<string, string> = {
  offer: "Angebot",
  confirmation: "Auftragsbestätigung",
  invoice: "Rechnung",
  partial: "Abschlagsrechnung",
  final: "Schlussrechnung",
  credit: "Stornorechnung",
};
export const docTitle = (docType: string): string => DOC_TITLE[docType] ?? "Beleg";

/** Dateiname des Dokuments, z. B. `Rechnung_2026-0001.pdf`, XRechnung: `Rechnung_2026-0001_xrechnung.xml`. Ein Entwurf bekommt `Entwurf`. */
export function documentFileName(docType: string, number: string, ext: "pdf" | "xml"): string {
  const base = `${docTitle(docType)}_${number ? safeName(number, 40) : "Entwurf"}`;
  return ext === "xml" ? `${base}_xrechnung.xml` : `${base}.pdf`;
}

/** Betrag für Mailtexte: normales Leerzeichen statt geschütztem. */
const money = (cents: number): string => formatCents(cents, "de-DE").replaceAll(String.fromCharCode(0xa0), " ").replaceAll(String.fromCharCode(0x202f), " ");

/** Steuerzeichen, Zeilen-/Absatztrenner und Umkehrzeichen (Bidi) entfernen: Namen im Mailtext bleiben einzeilig. */
const CONTROL = new RegExp(`[\u0000-\u001f\u007f-\u009f${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]+`, "g");
const plain = (value: string, max: number): string => value.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);

export type MailTextInput = {
  docType: string;
  number: string;
  recipientName: string;
  /** zu zahlender Betrag bzw. Angebotssumme, brutto */
  amountCents: number;
  dueDate: string | null;
  validUntil: string | null;
  workshopName: string;
  hasXml: boolean;
};

/**
 * Betreff und Text der Mail zu einem Beleg. **Vorlage fest (Deutsch); eingesetzt werden nur Nummer, Name, Betrag, Datum und Werkstattname** – alles einzeilig und von Steuerzeichen befreit
 * (keine Zeilenumbrüche aus Kundennamen, keine Kopfzeilen-Einschleusung). `date` formatiert JJJJ-MM-TT für den Text (TT.MM.JJJJ).
 */
export function mailContent(input: MailTextInput): { subject: string; text: string } {
  const title = docTitle(input.docType);
  const number = plain(input.number, 60);
  const name = plain(input.recipientName, 120);
  const workshop = plain(input.workshopName, 120);
  const date = (key: string) => key.split("-").reverse().join(".");
  const lines = [`Guten Tag${name ? ` ${name}` : ""},`, "", `anbei erhalten Sie ${input.docType === "confirmation" || input.docType === "offer" ? "unser" : "unsere"} ${title} Nr. ${number} über ${money(input.amountCents)}.`];
  if (input.docType === "offer" && input.validUntil) lines.push(`Das Angebot ist gültig bis ${date(input.validUntil)}.`);
  else if (isInvoiceType(input.docType) && input.docType !== "credit" && input.dueDate) lines.push(`Bitte überweisen Sie den Betrag bis zum ${date(input.dueDate)}.`);
  if (input.hasXml) lines.push("", "Die Rechnung liegt zusätzlich als XRechnung (XML) bei.");
  lines.push("", "Mit freundlichen Grüßen", workshop);
  return { subject: sanitizeSubject(`${title} ${number}${workshop ? ` – ${workshop}` : ""}`), text: lines.join("\n") };
}

/** JJJJ-MM-TT → TT.MM.JJJJ */
export const dateDe = (key: string | null): string => (key ? key.split("-").reverse().join(".") : "");

/** Verwendungszweck im Girocode und in der XRechnung: „Rechnung 2026-0001“. */
export const paymentReference = (docType: string, number: string): string => `${docTitle(docType)} ${plain(number, 60)}`;

/** Heute als Kalendertag der Werkstatt (für Fälligkeit und Gültigkeit). */
export const todayKey = (now = new Date()): string => dayKey(now);
