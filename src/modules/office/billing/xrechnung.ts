import "server-only";
import { buildUblXml, einvoiceProblems, type EinvoiceInput } from "@/lib/einvoice/ubl";
import { isInvoiceType } from "./constants";
import { dateDe, paymentReference } from "./domain";
import type { DocView } from "./view";

/**
 * Die **XRechnung** (UBL 2.1, XRechnung 3.0) eines festgeschriebenen Buchungsbelegs: aus dem Ansichtsmodell (bei festgeschriebenen Belegen aus dem Schnappschuss) deterministisch erzeugt, nichts wird gespeichert
 * (außer beim Versand als Anhang). `xrechnungProblems` nennt vorab, was noch fehlt (Seite, Route, Versand zeigen dieselbe Liste). Der Schreiber selbst steht in `src/lib/einvoice/ubl.ts`.
 */


const XML_TYPE: Record<string, EinvoiceInput["type"]> = { invoice: "invoice", final: "invoice", partial: "partial", credit: "credit" };

/** Die Eingabe des XML-Schreibers aus dem Ansichtsmodell (nur Buchungsbelege). */
export function einvoiceInputOf(view: DocView): EinvoiceInput {
  const credit = view.docType === "credit";
  return {
    type: XML_TYPE[view.docType] ?? "invoice",
    number: view.number,
    issueDate: view.issueDay,
    dueDate: credit ? null : view.dueDay,
    serviceFrom: view.serviceFrom,
    serviceTo: view.serviceTo,
    buyerReference: view.buyerReference ?? "",
    orderNumber: view.orderNumber,
    seller: {
      name: view.sender.name,
      street: view.sender.street,
      zip: view.sender.zip,
      city: view.sender.city,
      email: view.sender.email,
      phone: view.sender.phone,
      contactName: view.sender.director || view.sender.name,
      vatId: view.sender.vatId,
      taxNumber: view.sender.taxNumber,
      registerNumber: view.sender.registerNumber,
    },
    buyer: { name: view.recipient.name, street: view.recipient.street, zip: view.recipient.zip, city: view.recipient.city, email: view.recipient.email },
    smallBusiness: view.exempt,
    taxNote: view.taxNote,
    lines: view.items.map((item) => ({ description: item.description, unit: item.unit, quantityMilli: item.quantityMilli, unitCents: item.unitCents, taxBp: item.taxBp, discountBp: item.discountBp })),
    payment: { method: (["transfer", "cash", "card", "other"] as const).find((m) => m === view.paymentMethod) ?? "transfer", iban: view.sender.iban, bic: view.sender.bic, accountHolder: view.sender.name, reference: paymentReference(view.docType, view.number) },
    paymentTerms: credit || !view.dueDay ? null : `Zahlbar bis ${dateDe(view.dueDay)} ohne Abzug.`,
    prepaid: { cents: Math.abs(view.deductedCents), refs: credit ? [] : view.deductions.map((d) => ({ number: d.number, issueDate: d.issueDay })) },
    creditOf: view.cancels ? { number: view.cancels.number, issueDate: view.cancels.issueDay } : null,
  };
}

/** Was für die XRechnung noch fehlt (Codes, `billing.xrechnung.problems.<code>`); leer = vollständig. Entwürfe haben keine XRechnung. */
export function xrechnungProblems(view: DocView): string[] {
  if (view.draft) return ["draft"];
  if (!isInvoiceType(view.docType)) return ["notInvoice"];
  return einvoiceProblems(einvoiceInputOf(view));
}

/** Die XRechnung (UBL) als Text; wirft `EinvoiceError` mit den fehlenden Angaben. */
export function buildDocumentXml(view: DocView): string {
  return buildUblXml(einvoiceInputOf(view));
}
