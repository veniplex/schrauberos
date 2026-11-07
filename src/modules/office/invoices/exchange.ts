import { endOfDayIn, startOfDayIn } from "@/lib/dates";
import { findCustomerIdsByNumber, numberKey } from "@/modules/workshop/customers/public";
import type { AppSession } from "@/server/auth/session";
import { columnSpecs } from "@/server/csv/columns";
import { defineImport } from "@/server/csv/define-import";
import { formatDay, parseDay } from "@/server/csv/format";
import type { RowCheck } from "@/server/csv/import";
import { pageArgs, paged } from "@/server/csv/paging";
import { enumParser, zodRowMessages } from "@/server/csv/row";
import type { ExportDef } from "@/server/csv/types";
import { moneyCell } from "@/server/csv/writer";
import { db } from "@/server/db";
import { ACCOUNTANT_COLUMNS, EXPORT_ONLY_COLUMNS, INVOICE_COLUMNS } from "./exchange-columns";
import { DOC_TYPES_LEDGER, INVOICE_DIRECTIONS, INVOICE_STATUSES, outgoingKeyOf, paymentState } from "./domain";
import { invoiceImportInput, invoiceRecord, type InvoiceImportFields } from "./operations";
import { ledgerWhere } from "./queries";

/** Der Kunde einer Ausgangsrechnung steht nur mit dem Recht, Kunden zu sehen, in der Datei (Richtlinie D7). */
const mayUseCustomer = (session: AppSession) => session.features.has("workshop.customers") && session.can("customers.view");
const columnsFor = (session: AppSession) => (mayUseCustomer(session) ? INVOICE_COLUMNS : INVOICE_COLUMNS.filter((c) => c.key !== "customerNumber"));

const isDay = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDay(value) === value;
const startOf = (day: string) => startOfDayIn(day);
const endOf = (day: string) => endOfDayIn(day);

/**
 * Export des Rechnungsarchivs (`invoices.export` und `invoices.view`) mit allen Feldern des Formulars – ohne Belege. Auswahl: `direction=incoming|outgoing` (sonst beide),
 * `from`/`to` (Rechnungsdatum, `JJJJ-MM-TT`). Der Kunde einer Ausgangsrechnung erscheint nur als Kundennummer und nur mit `customers.view`.
 */
export const invoicesExport: ExportDef = {
  id: "invoices",
  feature: "office.invoices",
  permission: "invoices.export",
  also: ["invoices.view"],
  audit: "invoice.export",
  filename: () => `rechnungen-${formatDay(new Date())}.csv`,
  open: async ({ session, query, format, t }) => {
    const direction = query.get("direction");
    const from = query.get("from");
    const to = query.get("to");
    if ((from && !isDay(from)) || (to && !isDay(to)) || (from && to && from > to)) return { error: "invoices.exchange.periodInvalid" };
    // nur die Ausgangsliste: keine Angebote, Auftragsbestätigungen und Entwürfe der Rechnungserstellung
    const where = {
      ...ledgerWhere,
      ...(direction === "incoming" || direction === "outgoing" ? { direction } : {}),
      ...(from || to ? { issueDate: { ...(from ? { gte: startOf(from) } : {}), ...(to ? { lte: endOf(to) } : {}) } } : {}),
    };
    const withCustomer = mayUseCustomer(session);
    const dir = (code: string) => t(`invoices.tabs.${code as (typeof INVOICE_DIRECTIONS)[number]}`);
    const status = (code: string) => t(`invoices.statuses.${code as (typeof INVOICE_STATUSES)[number]}`);
    async function* rows() {
      for await (const i of paged((page) =>
        db.invoice.findMany({ ...pageArgs(page), where, orderBy: [{ issueDate: "asc" }, { id: "asc" }], include: { customer: { select: { customerNumber: true } }, cancels: { select: { number: true } } } }),
      )) {
        yield [
          dir(i.direction),
          i.number,
          i.partyName,
          formatDay(i.issueDate),
          i.dueDate ? formatDay(i.dueDate) : null,
          moneyCell(i.netCents, format),
          moneyCell(i.vatCents, format),
          moneyCell(i.grossCents, format),
          status(i.status),
          i.paidAt ? formatDay(i.paidAt) : null,
          i.category,
          i.reference,
          i.notes,
          ...(withCustomer ? [i.customer?.customerNumber ?? null] : []),
          i.finalizedAt ? formatDay(i.finalizedAt) : null,
          i.cancels?.number ?? null,
          t(`invoices.docTypes.${i.docType as (typeof DOC_TYPES_LEDGER)[number]}`),
          moneyCell(i.deductedCents, format),
          moneyCell(i.paidCents, format),
        ];
      }
    }
    return { columns: [...columnsFor(session), ...EXPORT_ONLY_COLUMNS], count: await db.invoice.count({ where }), target: [direction, from, to].filter(Boolean).join(" "), rows: rows() };
  },
};

/**
 * Steuerberater-Export (`invoices.export` und `invoices.view`): die Rechnungen eines Zeitraums (Rechnungsdatum von `from` bis `to`, beide Pflicht) – Eingang, Ausgang oder beide
 * (`direction`) – mit Nummer, Datum, Geschäftspartner, Netto, MwSt., Brutto und Zahlstatus. **Ohne Belege**, ohne Kategorie und Notizen, ohne Kundennummern.
 */
export const accountantExport: ExportDef = {
  id: "accountant",
  feature: "office.invoices",
  permission: "invoices.export",
  also: ["invoices.view"],
  audit: "invoice.accountantExport",
  filename: (query) => `rechnungen-steuerberater-${query.get("from") ?? ""}_${query.get("to") ?? ""}.csv`,
  open: async ({ query, format, t }) => {
    const direction = query.get("direction");
    const from = query.get("from");
    const to = query.get("to");
    if (!isDay(from) || !isDay(to) || from > to) return { error: "invoices.exchange.periodInvalid" };
    const where = {
      ...ledgerWhere,
      ...(direction === "incoming" || direction === "outgoing" ? { direction } : {}),
      issueDate: { gte: startOf(from), lte: endOf(to) },
    };
    const dir = (code: string) => t(`invoices.tabs.${code as (typeof INVOICE_DIRECTIONS)[number]}`);
    const now = new Date();
    async function* rows() {
      for await (const i of paged((page) => db.invoice.findMany({ ...pageArgs(page), where, orderBy: [{ issueDate: "asc" }, { number: "asc" }, { id: "asc" }], include: { cancels: { select: { number: true } } } }))) {
        yield [
          dir(i.direction),
          i.number,
          formatDay(i.issueDate),
          i.partyName,
          moneyCell(i.netCents, format),
          moneyCell(i.vatCents, format),
          moneyCell(i.grossCents, format),
          t(`invoices.payment.${paymentState(i, now)}`),
          i.paidAt ? formatDay(i.paidAt) : null,
          i.finalizedAt ? formatDay(i.finalizedAt) : null,
          i.cancels?.number ?? null,
          t(`invoices.docTypes.${i.docType as (typeof DOC_TYPES_LEDGER)[number]}`),
          moneyCell(i.deductedCents, format),
          moneyCell(i.paidCents, format),
        ];
      }
    }
    return { columns: ACCOUNTANT_COLUMNS, count: await db.invoice.count({ where }), target: `${direction === "incoming" || direction === "outgoing" ? `${direction} ` : ""}${from}..${to}`, rows: rows() };
  },
};

const directionOf = enumParser(INVOICE_DIRECTIONS, (code) => `invoices.tabs.${code}`, { Eingangsrechnung: "incoming", Ausgangsrechnung: "outgoing", Eingangsrechnungen: "incoming", Ausgangsrechnungen: "outgoing" });
const statusOf = enumParser(INVOICE_STATUSES, (code) => `invoices.statuses.${code}`);

/** Eine Zeile des Imports: die geprüfte Eingabe des Rechnungsformulars, die Kundennummer (nur Ausgang) und nach der Prüfung gegen die Datenbank die Kennung des Kunden. */
type InvoiceRow = { fields: InvoiceImportFields; customerNumber?: string; customerId?: string };

function parseInvoice(values: Record<string, string>) {
  const { customerNumber, ...rest } = values;
  const input: Record<string, string> = { ...rest };
  for (const key of ["issueDate", "dueDate", "paidAt"] as const) if (input[key]) input[key] = parseDay(input[key]) ?? input[key];
  if (input.direction) input.direction = directionOf(input.direction) ?? input.direction;
  if (input.status) input.status = statusOf(input.status) ?? input.status;
  const parsed = invoiceImportInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, messages: zodRowMessages(parsed.error) };
  const data: InvoiceRow = { fields: parsed.data, customerNumber: parsed.data.direction === "outgoing" ? customerNumber : undefined };
  return { ok: true as const, data };
}

const incomingKey = (number: string, party: string) => `i:${number.trim().toLowerCase()}|${party.trim().toLowerCase()}`;
const keyOfRow = (row: InvoiceRow) => (row.fields.direction === "outgoing" ? `o:${outgoingKeyOf("outgoing", row.fields.number)}` : incomingKey(row.fields.number, row.fields.partyName));

/**
 * Import ins Rechnungsarchiv (`invoices.import`): legt nur neue Rechnungen an, **ohne Belege**. Dieselben Prüfungen wie das Formular (Brutto Pflicht und nicht null, Netto + MwSt. = Brutto,
 * Fälligkeit nicht vor dem Rechnungsdatum). Dublette: Ausgang – die Rechnungsnummer (normalisiert, wie die Eindeutigkeit der Ausgangsnummern); Eingang – gleiche Nummer beim gleichen
 * Geschäftspartner. Dubletten werden übersprungen; eine Ausgangsnummer lässt sich nicht doppelt vergeben, also gibt es hier keine Möglichkeit, sie trotzdem anzulegen.
 */
export const invoicesImport = defineImport<InvoiceRow>({
  id: "invoices",
  feature: "office.invoices",
  permission: "invoices.import",
  operationName: "invoices.import",
  audit: "invoice.import",
  columns: (session) => columnSpecs(columnsFor(session)),
  parse: parseInvoice,
  label: (row) => `${row.fields.number} · ${row.fields.partyName}`,
  fileKeys: (row) => [keyOfRow(row)],
  check: async (tx, rows) => {
    const result = new Map<number, RowCheck>();
    const customers = await findCustomerIdsByNumber(tx, rows.flatMap((r) => (r.data.customerNumber ? [r.data.customerNumber] : [])));
    for (const { index, data } of rows) {
      if (!data.customerNumber) continue;
      const found = customers.get(numberKey(data.customerNumber)) ?? [];
      if (found.length === 1) data.customerId = found[0];
      else result.set(index, { kind: "error", message: { column: "customerNumber", key: found.length === 0 ? "exchange.row.notFound" : "exchange.row.ambiguous" } });
    }

    const taken = new Set<string>();
    const outgoing = [...new Set(rows.filter((r) => r.data.fields.direction === "outgoing").map((r) => outgoingKeyOf("outgoing", r.data.fields.number) ?? ""))];
    for (let i = 0; i < outgoing.length; i += 500) {
      for (const inv of await tx.invoice.findMany({ where: { outgoingKey: { in: outgoing.slice(i, i + 500) } }, select: { outgoingKey: true } })) if (inv.outgoingKey) taken.add(`o:${inv.outgoingKey}`);
    }
    const numbers = [...new Set(rows.filter((r) => r.data.fields.direction === "incoming").map((r) => r.data.fields.number))];
    for (let i = 0; i < numbers.length; i += 500) {
      for (const inv of await tx.invoice.findMany({ where: { direction: "incoming", number: { in: numbers.slice(i, i + 500) } }, select: { number: true, partyName: true } })) taken.add(incomingKey(inv.number, inv.partyName));
    }
    for (const { index, data } of rows) {
      if (!result.has(index) && taken.has(keyOfRow(data))) {
        result.set(index, { kind: "duplicate", message: { key: "invoices.exchange.duplicate", params: { number: data.fields.number } } });
      }
    }
    return result;
  },
  create: async (tx, rows) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx.invoice.createMany({ data: rows.slice(i, i + 500).map((r) => invoiceRecord(r.fields, r.customerId ?? null)) });
    }
  },
});
