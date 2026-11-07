import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { defineOperation, fail } from "@/server/operations";
import { customerDisplayName, customerHasLinks, customerSearchKeys } from "./domain";

/** Eingabe eines Kunden – auch die Prüfung der Zeilen des CSV-Imports (`exchange.ts`). */
export const customerInput = z
  .object({
    id: z.string().optional(),
    version: z.string().optional(),
    customerNumber: z.string().max(40).optional(),
    firstName: z.string().max(80).optional(),
    lastName: z.string().max(120).optional(),
    company: z.string().max(120).optional(),
    email: z.string().email().max(200).optional(),
    phone: z.string().max(60).optional(),
    street: z.string().max(120).optional(),
    zip: z.string().max(12).optional(),
    city: z.string().max(80).optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.lastName && !d.company) ctx.addIssue({ code: "custom", message: "customers.errors.nameRequired", path: ["lastName"] });
  });

export type CustomerFields = z.output<typeof customerInput>;

/** Die Felder der Tabelle zu einer geprüften Eingabe (Anlegen, Ändern und CSV-Import gleich). */
export function customerRecord(d: CustomerFields) {
  // Bei reinen Firmenkunden dient der Firmenname als Nachname (Sortierung/Suche)
  const lastName = d.lastName ?? d.company!;
  return {
    customerNumber: d.customerNumber ?? null,
    firstName: d.firstName ?? null,
    lastName,
    company: d.company ?? null,
    email: d.email ?? null,
    phone: d.phone ?? null,
    street: d.street ?? null,
    zip: d.zip ?? null,
    city: d.city ?? null,
    notes: d.notes ?? null,
    ...customerSearchKeys({ ...d, lastName }),
  };
}

export const saveCustomerOperation = defineOperation({
  name: "customers.save",
  permission: "customers.edit",
  input: customerInput,
  audit: (input) => (input.id ? "customer.update" : "customer.create"),
  run: async ({ input: { id, version, ...d }, tx, audit }) => {
    const data = customerRecord(d);
    if (id && !(await claimRow(tx.customer, id, version))) fail("conflict");
    const saved = id ? await tx.customer.update({ where: { id }, data }) : await tx.customer.create({ data });
    audit({ target: customerDisplayName(saved), entityId: saved.id });
    return { id: saved.id };
  },
});

export const deleteCustomerOperation = defineOperation({
  name: "customers.delete",
  permission: "customers.delete",
  input: z.object({ id: z.string().min(1) }),
  audit: "customer.delete",
  run: async ({ input, tx, audit }) => {
    const customer = await tx.customer.findUnique({ where: { id: input.id }, include: { _count: { select: { vehicles: true, ownerships: true, invoices: true } } } });
    if (!customer) fail("notFound");
    // Kunden mit Fahrzeugen, Halter-Historie oder Rechnungen bleiben erhalten (Nachvollziehbarkeit); im Schema zusätzlich per Restrict gesichert
    const links = customer._count;
    if (customerHasLinks(links)) fail("inUse", "customers.errors.inUse", { vehicles: links.vehicles, ownerships: links.ownerships, invoices: links.invoices });
    await tx.customer.delete({ where: { id: input.id } });
    audit({ target: customerDisplayName(customer), entityId: input.id });
    return { id: input.id };
  },
});

