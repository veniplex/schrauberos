import { isValidBic, isValidIban, normalizeBic, normalizeIban } from "./bank-tax";

/**
 * Girocode (EPC-QR-Code, „Überweisen per Bank-App scannen“): Inhalt nach dem Standard EPC069-12, Version 002, **Zeichensatz 1 = UTF-8**, SEPA-Überweisung (SCT). Reine Funktion; den Code zeichnet
 * der PDF-Baustein (`PdfBuilder.qr`, der Text wird als UTF-8 kodiert – siehe `lib/qr.ts`).
 *
 * Grenzen des Standards: Name des Empfängers höchstens 70 Zeichen, Verwendungszweck (unstrukturiert) höchstens 140 Zeichen, Betrag 0,01 bis 999 999 999,99 EUR, der ganze Inhalt höchstens 331 Bytes.
 * Die BIC ist im EWR-Zahlungsverkehr (Version 002) optional. Gibt es keinen gültigen Code (ungültige IBAN, Betrag außerhalb, zu lang), liefert die Funktion `null` – das Dokument bekommt dann einfach keinen.
 */
export const EPC_MAX_BYTES = 331;
export const EPC_MAX_AMOUNT_CENTS = 99_999_999_999;

export type GirocodeInput = { name: string; iban: string; bic?: string | null; amountCents: number; reference: string };

/** Steuerzeichen und Zeilenumbrüche würden die Zeilenstruktur des Inhalts zerstören. */
const LINE_BREAKS = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, "g");
const oneLine = (value: string, max: number): string => Array.from(value.replace(LINE_BREAKS, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("");

export function epcPayload(input: GirocodeInput): string | null {
  const iban = normalizeIban(input.iban);
  if (!isValidIban(iban)) return null;
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > EPC_MAX_AMOUNT_CENTS) return null;
  const name = oneLine(input.name, 70);
  if (!name) return null;
  const bic = input.bic ? normalizeBic(input.bic) : "";
  if (bic && !isValidBic(bic)) return null;
  const euros = Math.trunc(input.amountCents / 100);
  const amount = `EUR${euros}.${String(input.amountCents % 100).padStart(2, "0")}`;
  const lines = ["BCD", "002", "1", "SCT", bic, name, iban, amount, "", "", oneLine(input.reference, 140)];
  const text = lines.join("\n");
  return new TextEncoder().encode(text).length > EPC_MAX_BYTES ? null : text;
}
