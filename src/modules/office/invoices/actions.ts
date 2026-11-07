"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { cancelInvoiceOperation, deleteInvoiceOperation, finalizeInvoiceOperation, markInvoicePaidOperation, reopenInvoiceOperation, saveInvoiceOperation } from "./operations";

const paths = (id: string) => ["/invoices", "/", `/invoices/${id}`] as const;

export const saveInvoice = defineAction(saveInvoiceOperation, {
  form: (fd) => {
    const file = fd.get("file");
    return { ...formObject(fd), file: file instanceof File && file.size > 0 ? file : undefined, removeFile: fd.get("removeFile") === "on" };
  },
  revalidate: ({ id }) => paths(id),
  redirect: ({ id }) => `/invoices/${id}`,
});

export const markInvoicePaid = defineAction(markInvoicePaidOperation, { revalidate: ({ id }) => paths(id), message: "invoices.flash.paid" });

export const reopenInvoice = defineAction(reopenInvoiceOperation, { revalidate: ({ id }) => paths(id), message: "invoices.flash.reopened" });

export const deleteInvoice = defineAction(deleteInvoiceOperation, {
  revalidate: ["/invoices", "/"],
  redirect: ({ direction }) => `/invoices?dir=${direction}`,
  message: "common.deleted",
});

export const finalizeInvoice = defineAction(finalizeInvoiceOperation, { revalidate: ({ id }) => paths(id), message: "invoices.flash.finalized" });

export const cancelInvoice = defineAction(cancelInvoiceOperation, {
  revalidate: ({ id, counterId }) => [...paths(id), ...paths(counterId), "/billing", `/billing/${id}`, `/billing/${counterId}`],
  // Belege der Rechnungserstellung bleiben dort (auf der Seite der Stornorechnung), solange die Funktion aktiv ist; sonst das Rechnungsarchiv
  redirect: ({ counterId, fromBilling }, _input, principal) => (fromBilling && principal.features.has("office.billing") ? `/billing/${counterId}` : `/invoices/${counterId}`),
  message: "invoices.flash.cancelled",
});
