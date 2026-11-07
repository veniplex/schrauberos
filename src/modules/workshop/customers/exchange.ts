import { archivedWhere, parseArchiveFilter } from "@/lib/archive-filter";
import { formatDay } from "@/server/csv/format";
import { columnSpecs } from "@/server/csv/columns";
import { defineImport } from "@/server/csv/define-import";
import { paged, pageArgs } from "@/server/csv/paging";
import { zodRowMessages } from "@/server/csv/row";
import type { ExportDef } from "@/server/csv/types";
import { db } from "@/server/db";
import { CUSTOMER_COLUMNS } from "./exchange-columns";
import { customerInput, customerRecord, type CustomerFields } from "./operations";

/**
 * Export und Import der Kunden (`customers.export` / `customers.import`, nie in Standardrollen). Der Export enthält personenbezogene Daten (Name, Anschrift, Telefon, E-Mail)
 * und genau die Felder des Kundenformulars – keine internen Kennungen, keine Herkunft aus einer Synchronisierung.
 */
export const customersExport: ExportDef = {
  id: "customers",
  feature: "workshop.customers",
  permission: "customers.export",
  also: ["customers.view"],
  audit: "customer.export",
  filename: () => `kunden-${formatDay(new Date())}.csv`,
  // Standard nur aktive Kunden; `archived=1` nur archivierte, `archived=all` alle (P4b-2)
  open: async ({ query }) => {
    const where = archivedWhere(parseArchiveFilter(query.get("archived")));
    return { columns: CUSTOMER_COLUMNS, count: await db.customer.count({ where }), target: "", rows: rows(where) };
  },
};

async function* rows(where: ReturnType<typeof archivedWhere>) {
  for await (const c of paged((page) => db.customer.findMany({ ...pageArgs(page), where, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }] }))) {
    yield [c.customerNumber, c.firstName, c.lastName, c.company, c.email, c.phone, c.street, c.zip, c.city, c.notes];
  }
}

const lower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const compact = (value: string | null | undefined) => lower(value).replace(/\s+/g, " ");

/** Schlüssel, an denen sich ein Kunde wiedererkennen lässt: Kundennummer; E-Mail-Adresse mit Nachname; Name mit Anschrift (nur, wenn eine Anschrift da ist). */
function identityKeys(c: { customerNumber?: string | null; email?: string | null; lastName?: string | null; company?: string | null; firstName?: string | null; street?: string | null; zip?: string | null }): string[] {
  const keys: string[] = [];
  if (c.customerNumber) keys.push(`n:${compact(c.customerNumber).replace(/\s/g, "")}`);
  const last = lower(c.lastName ?? c.company);
  if (c.email) keys.push(`e:${lower(c.email)}|${last}`);
  if (c.street || c.zip) keys.push(`a:${compact(c.firstName)}|${last}|${compact(c.company)}|${compact(c.zip)}|${compact(c.street)}`);
  return keys;
}

export const customersImport = defineImport<CustomerFields>({
  id: "customers",
  feature: "workshop.customers",
  permission: "customers.import",
  operationName: "customers.import",
  audit: "customer.import",
  columns: () => columnSpecs(CUSTOMER_COLUMNS),
  parse: (values) => {
    const parsed = customerInput.safeParse(values);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, messages: zodRowMessages(parsed.error) };
  },
  label: (c) => [c.company ?? "", [c.firstName, c.lastName !== c.company ? c.lastName : null].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || c.lastName || "–",
  // Dublette: gleiche Kundennummer, gleiche E-Mail-Adresse mit gleichem Namen oder gleicher Name mit gleicher Anschrift – Kunden werden nie überschrieben, nur neue angelegt
  fileKeys: (c) => identityKeys({ ...c, lastName: c.lastName ?? c.company }),
  check: async (tx, rows) => {
    const existing = new Set<string>();
    for (const c of await tx.customer.findMany({ select: { customerNumber: true, email: true, lastName: true, company: true, firstName: true, street: true, zip: true } })) {
      for (const key of identityKeys(c)) existing.add(key);
    }
    const result = new Map<number, { kind: "duplicate"; message: { key: "customers.exchange.duplicate" } }>();
    for (const { index, data } of rows) {
      if (identityKeys({ ...data, lastName: data.lastName ?? data.company }).some((k) => existing.has(k))) result.set(index, { kind: "duplicate", message: { key: "customers.exchange.duplicate" } });
    }
    return result;
  },
  create: async (tx, rows) => {
    for (let i = 0; i < rows.length; i += 500) await tx.customer.createMany({ data: rows.slice(i, i + 500).map(customerRecord) });
  },
});
