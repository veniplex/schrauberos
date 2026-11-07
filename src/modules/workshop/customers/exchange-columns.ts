import type { ColumnDef } from "@/server/csv/columns";

/** Spalten des Kunden-Exports und -Imports (Reihenfolge = Reihenfolge der Datei). Dieselben Schlüssel wie die Felder des Kundenformulars. */
export const CUSTOMER_COLUMNS: readonly ColumnDef[] = [
  { key: "customerNumber", labelKey: "customers.exchange.cols.customerNumber", aliases: ["Kundennr", "Kd-Nr", "KdNr", "Customer no", "Customer number"] },
  { key: "firstName", labelKey: "customers.exchange.cols.firstName", aliases: ["First name", "Given name"] },
  { key: "lastName", labelKey: "customers.exchange.cols.lastName", aliases: ["Familienname", "Name", "Last name", "Surname"] },
  { key: "company", labelKey: "customers.exchange.cols.company", aliases: ["Unternehmen", "Company"] },
  { key: "email", labelKey: "customers.exchange.cols.email", aliases: ["Mail", "E-Mail-Adresse", "Email address"] },
  { key: "phone", labelKey: "customers.exchange.cols.phone", aliases: ["Tel", "Telefonnummer", "Mobil", "Phone"] },
  { key: "street", labelKey: "customers.exchange.cols.street", aliases: ["Strasse", "Anschrift", "Address"] },
  { key: "zip", labelKey: "customers.exchange.cols.zip", aliases: ["Postleitzahl", "Zip", "Postcode", "Postal code"] },
  { key: "city", labelKey: "customers.exchange.cols.city", aliases: ["Stadt", "City"] },
  { key: "notes", labelKey: "customers.exchange.cols.notes", aliases: ["Bemerkung", "Bemerkungen", "Notes"], multiline: true },
];
