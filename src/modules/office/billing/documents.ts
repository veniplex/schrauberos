import "server-only";
import { SMALL_BUSINESS_NOTE } from "@/lib/einvoice/ubl";
import { formatIban } from "@/lib/bank-tax";
import { epcPayload } from "@/lib/girocode";
import { QUANTITY_DECIMALS, lineResult, scaledToInput } from "@/lib/line-items";
import { sanitizeImage } from "@/lib/image-sanitize";
import { LOGO_LIMITS, parseLogoDataUrl } from "@/lib/logo";
import { formatCents } from "@/lib/money";
import { createPdf, mm } from "@/server/pdf";
import { dateDe, docTitle, paymentReference } from "./domain";
import { isInvoiceType } from "./constants";
import { viewPayable, type DocView } from "./view";

/**
 * Das **PDF** eines Beleges (Angebot, Auftragsbestätigung, Rechnung, Abschlag, Schlussrechnung, Stornorechnung); die XRechnung (UBL, nur Buchungsbelege) steht in `xrechnung.ts` – getrennt, weil die PDF-Bibliothek nur beim Erzeugen eines PDF geladen werden soll (nicht von jeder Seite, die nur wissen will, was für die XRechnung fehlt).
 * Beides entsteht bei jedem Abruf deterministisch aus dem Ansichtsmodell (`view.ts`) – bei festgeschriebenen Belegen aus dem Schnappschuss; es wird nichts gespeichert (außer den beim Versand
 * angehängten Dateien). Das PDF hat die feste Erstellzeit des Festschreibens. Normales PDF, **kein** PDF/A-3 (siehe README, „PDF-Erzeugung“); die XRechnung liegt getrennt daneben.
 *
 * Alle Texte sind deutsch (Belege werden auf Deutsch ausgestellt). Längen- und Seitengrenzen der PDF-Erzeugung (`PdfError`) gelten unverändert.
 */

const eur = (cents: number): string => formatCents(cents, "de-DE").replaceAll(String.fromCharCode(0xa0), " ");
const quantityText = (milli: number): string => scaledToInput(milli, QUANTITY_DECIMALS, "de");
const percentText = (bp: number): string => `${scaledToInput(bp, 2, "de")} %`;

const MAX_LINES_NOTE = 200;
const joinParts = (parts: Array<string | null | undefined>, separator = " · "): string => parts.filter((p): p is string => !!p && p.trim() !== "").join(separator);
const cityLine = (zip: string | null, city: string | null): string => joinParts([zip, city], " ");

/** Logo als Raster (PNG/JPEG) für das PDF; `null`, wenn es keins (oder ein nicht darstellbares) gibt. */
export function logoForPdf(dataUrl: string | null | undefined): Buffer | null {
  const logo = parseLogoDataUrl(dataUrl);
  if (!logo || (logo.mime !== "image/png" && logo.mime !== "image/jpeg")) return null;
  // Bildgröße erneut prüfen (auch ein früher gespeichertes Logo): zu viele Bildpunkte = kein Logo im PDF statt eines Speicherfressers (Z6-2 N1)
  const clean = sanitizeImage(logo.data, LOGO_LIMITS);
  return clean.ok ? clean.bytes : null;
}

/** Der Hinweis zur Steuer unter den Summen: Kleinunternehmer (§ 19 UStG) oder der Grund der Steuerbefreiung bei 0 %. */
function taxNoteOf(view: DocView): string | null {
  if (view.exempt) return SMALL_BUSINESS_NOTE;
  return view.items.some((item) => item.taxBp === 0) && view.taxNote ? view.taxNote : null;
}

export async function buildDocumentPdf(view: DocView, options: { logo?: Buffer | null } = {}): Promise<Buffer> {
  const title = docTitle(view.docType);
  const heading = view.draft ? `${title} (Entwurf)` : `${title} Nr. ${view.number}`;
  const invoiceLike = isInvoiceType(view.docType);
  const s = view.sender;
  const pdf = createPdf({
    title: heading,
    author: s.name,
    subject: view.draft ? "Entwurf" : `${title} ${view.number}`,
    creationDate: view.finalizedAt ?? new Date(),
    margins: { top: mm(18), bottom: mm(26) },
    runningHeader: view.draft ? `${heading} · ${view.recipient.name}` : `${title} ${view.number} · ${s.name}`,
    footer: { text: joinParts([s.name, s.taxNumber ? `Steuernummer ${s.taxNumber}` : s.vatId ? `USt-IdNr. ${s.vatId}` : null]) },
  });

  /* ── Kopf: Logo links, Absender rechts ── */
  const top = mm(18);
  if (options.logo) {
    try {
      pdf.image(options.logo, { width: mm(50), height: mm(18), x: pdf.left, y: top });
    } catch {
      // ein nicht lesbares oder zu großes Logo darf den Beleg nie verhindern
    }
  }
  pdf.y = top;
  const sideWidth = mm(70);
  const sideX = pdf.right - sideWidth;
  pdf.text(s.name, { x: sideX, width: sideWidth, size: 12, bold: true, align: "right", after: 1 });
  for (const line of [s.street, cityLine(s.zip, s.city), s.phone ? `Tel. ${s.phone}` : null, s.email, s.website]) if (line) pdf.text(line, { x: sideX, width: sideWidth, size: 8.5, muted: true, align: "right" });

  /* ── Anschriftenfeld und Belegdaten ── */
  pdf.y = Math.max(pdf.y + mm(4), mm(48));
  const blockTop = pdf.y;
  const addressWidth = mm(88);
  pdf.text(joinParts([s.name, s.street, cityLine(s.zip, s.city)]), { width: addressWidth, size: 7, muted: true, after: 3 });
  const r = view.recipient;
  pdf.text(r.name, { width: addressWidth, size: 10.5, bold: true });
  if (r.street) pdf.text(r.street, { width: addressWidth, size: 10.5 });
  if (cityLine(r.zip, r.city)) pdf.text(cityLine(r.zip, r.city), { width: addressWidth, size: 10.5 });
  const addressEnd = pdf.y;

  const infoX = pdf.left + mm(105);
  const infoLabel = mm(30);
  const infoValue = pdf.right - infoX - infoLabel;
  pdf.y = blockTop;
  const info: Array<[string, string | null]> = [
    [view.docType === "offer" ? "Angebotsdatum" : "Datum", view.draft ? "(wird beim Festschreiben gesetzt)" : dateDe(view.issueDay)],
    ["Nummer", view.draft ? "(wird beim Festschreiben vergeben)" : view.number],
    ["Kundennummer", r.customerNumber],
    [view.docType === "offer" ? "Gültig bis" : "Fällig am", view.docType === "offer" ? (view.validUntil ? dateDe(view.validUntil) : null) : view.dueDay && invoiceLike && view.docType !== "credit" ? dateDe(view.dueDay) : null],
    [view.serviceTo && view.serviceTo !== view.serviceFrom ? "Leistungszeitraum" : "Leistungsdatum", view.serviceFrom && invoiceLike ? (view.serviceTo && view.serviceTo !== view.serviceFrom ? `${dateDe(view.serviceFrom)} – ${dateDe(view.serviceTo)}` : dateDe(view.serviceFrom)) : null],
    ["Auftrag", view.orderNumber],
    ["Bezug", view.sourceNumber],
    ["Fahrzeug", view.vehicleLabel ? joinParts([view.vehicleLabel, view.mileageKm != null ? `${view.mileageKm.toLocaleString("de-DE")} km` : null]) : null],
    ["Referenz", view.buyerReference],
  ];
  for (const [label, value] of info) {
    if (!value) continue;
    const rowTop = pdf.y;
    pdf.text(label, { x: infoX, width: infoLabel, size: 8.5, muted: true });
    const afterLabel = pdf.y;
    pdf.y = rowTop;
    pdf.text(value, { x: infoX + infoLabel, width: infoValue, size: 8.5 });
    pdf.y = Math.max(pdf.y, afterLabel) + 1;
  }
  pdf.y = Math.max(pdf.y, addressEnd) + mm(9);

  /* ── Titel und Einleitung ── */
  pdf.text(heading, { size: 15, bold: true, color: view.draft ? "#b42318" : undefined, after: 2 });
  if (view.cancels) pdf.text(`Storno zu Rechnung Nr. ${view.cancels.number} vom ${dateDe(view.cancels.issueDay)}`, { size: 9.5, muted: true, after: 4 });
  if (view.draft) pdf.text("Entwurf – nicht gültig. Nummer und Datum vergibt das Festschreiben.", { size: 9, color: "#b42318", after: 4 });
  if (view.introText) pdf.text(view.introText, { size: 9.5, after: 6 });
  else pdf.space(4);

  /* ── Positionen ── */
  const anyDiscount = view.items.some((item) => item.discountBp !== 0);
  const showTax = !view.exempt;
  const columns = [
    { header: "Pos.", weight: 0.75, align: "right" as const },
    { header: "Beschreibung", weight: 4 },
    { header: "Menge", weight: 1.35, align: "right" as const },
    { header: "Einzelpreis", weight: 1.4, align: "right" as const },
    ...(anyDiscount ? [{ header: "Rabatt", weight: 0.95, align: "right" as const }] : []),
    ...(showTax ? [{ header: "MwSt.", weight: 0.85, align: "right" as const }] : []),
    { header: "Betrag", weight: 1.5, align: "right" as const },
  ];
  const rows = view.items.slice(0, MAX_LINES_NOTE).map((item, index) => [
    String(index + 1),
    item.description,
    joinParts([quantityText(item.quantityMilli), item.unit], " "),
    eur(item.unitCents),
    ...(anyDiscount ? [item.discountBp ? percentText(item.discountBp) : ""] : []),
    ...(showTax ? [percentText(item.taxBp)] : []),
    eur(lineResult({ ...item }).netCents),
  ]);
  pdf.table({ columns, rows, fontSize: 9 });

  /* ── Summen ── */
  const t = view.totals;
  // Mit angerechneten Abschlägen (Schlussrechnung) oder – beim Gegenbeleg einer Schlussrechnung – deren Spiegelung folgt eine Restbetragszeile
  const credit = view.docType === "credit";
  const hasDeductions = view.deductions.length > 0 || (credit && view.deductedCents !== 0);
  const totalRows: Array<{ label: string; value: string; strong?: boolean }> = view.exempt
    ? [{ label: "Gesamtbetrag", value: eur(t.grossCents), strong: !hasDeductions }]
    : [
        { label: "Nettosumme", value: eur(t.netCents) },
        ...t.taxGroups.map((group) => ({ label: `zzgl. ${percentText(group.taxBp)} MwSt. auf ${eur(group.netCents)}`, value: eur(group.taxCents) })),
        { label: "Gesamtbetrag brutto", value: eur(t.grossCents), strong: !hasDeductions },
      ];
  // § 14 Abs. 5 Satz 2 UStG: Die Endrechnung setzt die vereinnahmten Teilentgelte **und die darauf entfallenden Steuerbeträge** ab – je Abschlag das Entgelt, dann die Steuer je Satz (Wortlaut: Annahme, vom Steuerberater freizugeben)
  for (const d of view.deductions) {
    const from = `Abschlag ${d.number} vom ${dateDe(d.issueDay)}`;
    if (view.exempt) {
      totalRows.push({ label: `abzgl. ${from}`, value: eur(0 - d.grossCents) });
      continue;
    }
    totalRows.push({ label: `abzgl. ${from}: Entgelt`, value: eur(0 - d.netCents) });
    for (const group of d.taxGroups) {
      if (group.taxCents !== 0) totalRows.push({ label: `abzgl. darauf entfallende ${percentText(group.taxBp)} MwSt. auf ${eur(group.netCents)}`, value: eur(0 - group.taxCents) });
    }
  }
  // Gegenbeleg einer Schlussrechnung: die Abschläge bleiben gültig (sie wurden gezahlt) – gespiegelt wie auf der Originalrechnung, damit PDF und XRechnung (PrepaidAmount/PayableAmount) dasselbe sagen
  if (credit && view.deductedCents !== 0) {
    const label = "abzgl. Abschläge der stornierten Schlussrechnung (bleiben bestehen)";
    if (view.exempt) totalRows.push({ label, value: eur(0 - view.deductedCents) });
    else {
      totalRows.push({ label: `${label}: Entgelt`, value: eur(0 - view.deductedNetCents) });
      if (view.deductedVatCents !== 0) totalRows.push({ label: "abzgl. darauf entfallende Umsatzsteuer", value: eur(0 - view.deductedVatCents) });
    }
  }
  if (hasDeductions) totalRows.push({ label: credit ? "Erstattungsbetrag" : "Restbetrag (zu zahlen)", value: eur(viewPayable(view)), strong: true });
  pdf.space(2);
  pdf.totals(totalRows, { width: mm(95) });

  const note = taxNoteOf(view);
  if (note) pdf.text(note, { size: 9, after: 3 });
  pdf.space(4);

  /* ── Zahlung ── */
  const payable = viewPayable(view);
  if (invoiceLike && view.docType !== "credit" && !view.draft) {
    const terms = view.dueDay ? `Zahlbar bis ${dateDe(view.dueDay)} ohne Abzug.` : null;
    const method = view.paymentMethod;
    if (terms) pdf.text(terms, { size: 9.5, after: 2 });
    if (method === "cash") pdf.text("Zahlungsart: Barzahlung.", { size: 9.5, after: 2 });
    else if (method === "card") pdf.text("Zahlungsart: Kartenzahlung.", { size: 9.5, after: 2 });
    const reference = paymentReference(view.docType, view.number);
    const qr = method === "transfer" && s.iban && payable > 0 ? epcPayload({ name: s.name, iban: s.iban, bic: s.bic, amountCents: payable, reference }) : null;
    if (method === "transfer" && s.iban) {
      const blockHeight = qr ? mm(32) : mm(14);
      pdf.ensure(blockHeight);
      const bankTop = pdf.y;
      const bankWidth = qr ? pdf.contentWidth - mm(34) : pdf.contentWidth;
      pdf.text("Bankverbindung", { width: bankWidth, size: 9.5, bold: true, after: 1 });
      pdf.text(joinParts([s.bankName, `IBAN ${formatIban(s.iban)}`, s.bic ? `BIC ${s.bic}` : null], "\n"), { width: bankWidth, size: 9.5 });
      pdf.text(`Verwendungszweck: ${reference}`, { width: bankWidth, size: 9.5 });
      if (qr) {
        pdf.qr(qr, { size: mm(30), x: pdf.right - mm(30), y: bankTop });
        pdf.y = Math.max(pdf.y, bankTop + mm(31));
        pdf.text("Girocode: mit der Banking-App scannen", { x: pdf.right - mm(60), width: mm(60), size: 7, muted: true, align: "right" });
      }
    }
  } else if (view.docType === "offer") {
    if (view.validUntil) pdf.text(`Dieses Angebot ist gültig bis ${dateDe(view.validUntil)}.`, { size: 9.5, after: 2 });
  }

  /* ── Schlusstext und Pflichtangaben des Absenders ── */
  if (view.footerText) {
    pdf.space(4);
    pdf.text(view.footerText, { size: 9.5, after: 2 });
  }
  pdf.space(8);
  const legal = joinParts(
    [
      s.director ? `Geschäftsführer: ${s.director}` : null,
      s.registerCourt || s.registerNumber ? `Register: ${joinParts([s.registerCourt, s.registerNumber], ", ")}` : null,
      s.taxNumber ? `Steuernummer: ${s.taxNumber}` : null,
      s.vatId ? `USt-IdNr.: ${s.vatId}` : null,
    ],
    " · ",
  );
  if (legal) pdf.text(legal, { size: 7.5, muted: true });
  return pdf.finish();
}
