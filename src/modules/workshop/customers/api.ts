import { z } from "zod";
import type { Customer } from "@/generated/prisma/client";
import { archivedWhere, parseArchiveFilter } from "@/lib/archive-filter";
import { versionOf } from "@/lib/concurrency";
import { iso, nullableString, text } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { keyContains } from "@/server/search";
import { archiveCustomerOperation, deleteCustomerOperation, saveCustomerOperation, unarchiveCustomerOperation } from "./operations";
import { customerSearchFields, unrestrictedCustomerWhere } from "./queries";

/**
 * API-Ressource „Kunden“ (`/api/v1/customers`). Schreiben läuft über dieselben Operationen wie die Oberfläche (Prüfung der Sache, Audit); Kunden mit
 * Fahrzeugen, Halter-Historie oder Rechnungen bleiben unlöschbar (409) und werden stattdessen archiviert (`POST /customers/{id}/archive`, `/unarchive`);
 * archivierte Kunden stehen nur im Filter `archived=true` bzw. `archived=all`.
 */

const body = z.strictObject({
  customerNumber: text(40),
  firstName: text(80),
  lastName: text(120),
  company: text(120),
  email: z.email().max(200).nullable().optional(),
  phone: text(60),
  street: text(120),
  zip: text(12),
  city: text(80),
  notes: text(2000),
  /** Kundennummer trotz vorhandener Dublette speichern (Warnung bestätigt) */
  allowDuplicate: z.boolean().optional(),
});

const item = z.object({
  id: z.string(),
  version: z.string(),
  customerNumber: nullableString,
  firstName: nullableString,
  lastName: z.string(),
  company: nullableString,
  email: nullableString,
  phone: nullableString,
  street: nullableString,
  zip: nullableString,
  city: nullableString,
  notes: nullableString,
  /** Zeitpunkt der Archivierung; null = aktiv */
  archivedAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const endpoints = defineResource({
  feature: "workshop.customers",
  tag: "Customers",
  name: "customers",
  singular: "customer",
  path: "/customers",
  read: "customers.view",
  model: db.customer as unknown as Delegate<Customer>,
  // eingeschränkte Kunden (Art. 18 DSGVO) gibt es für die API nicht: weder lesen noch ändern (404)
  scope: unrestrictedCustomerWhere,
  item,
  version: versionOf,
  toItem: (c): z.input<typeof item> => ({
    id: c.id,
    version: versionOf(c),
    customerNumber: c.customerNumber,
    firstName: c.firstName,
    lastName: c.lastName,
    company: c.company,
    email: c.email,
    phone: c.phone,
    street: c.street,
    zip: c.zip,
    city: c.city,
    notes: c.notes,
    archivedAt: c.archivedAt ? iso(c.archivedAt) : null,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  }),
  list: {
    filters: z.strictObject({
      q: z.string().max(100).optional(),
      city: z.string().max(80).optional(),
      /** Archiv: `false` (Standard) nur aktive, `true` nur archivierte, `all` alle */
      archived: z.enum(["false", "true", "all"]).optional(),
    }),
    where: ({ q, city, archived }) => ({
      ...archivedWhere(parseArchiveFilter(archived === "false" ? undefined : archived)),
      ...(city ? keyContains("cityKey", city) : {}),
      ...(q ? { OR: customerSearchFields.map((f) => f.where(q)) } : {}),
    }),
    sorts: {
      lastName: (dir) => ({ lastName: dir }),
      customerNumber: (dir) => ({ customerNumber: dir }),
      city: (dir) => ({ city: dir }),
      createdAt: (dir) => ({ createdAt: dir }),
      updatedAt: (dir) => ({ updatedAt: dir }),
    },
    defaultSort: [{ key: "lastName", dir: "asc" }],
  },
  create: { permission: "customers.edit", operation: saveCustomerOperation, body, toInput: (b) => b },
  update: {
    permission: "customers.edit",
    operation: saveCustomerOperation,
    current: (c) => ({
      customerNumber: c.customerNumber,
      firstName: c.firstName,
      // bei reinen Firmenkunden steht der Firmenname zusätzlich im Nachnamen (siehe Operation): nicht als eigenen Nachnamen zurückgeben
      lastName: c.company && c.lastName === c.company ? null : c.lastName,
      company: c.company,
      email: c.email,
      phone: c.phone,
      street: c.street,
      zip: c.zip,
      city: c.city,
      notes: c.notes,
    }),
    toInput: (merged, { id, version }) => ({ ...merged, id, version }),
  },
  remove: { permission: "customers.delete", operation: deleteCustomerOperation },
  actions: [
    { name: "archive", summary: "Archive a customer: it stays with all links but disappears from selection fields, search and the default list", permission: "customers.edit", operation: archiveCustomerOperation, body: z.strictObject({}), toInput: (id) => ({ id }) },
    { name: "unarchive", summary: "Reactivate an archived customer", permission: "customers.edit", operation: unarchiveCustomerOperation, body: z.strictObject({}), toInput: (id) => ({ id }) },
  ],
});
