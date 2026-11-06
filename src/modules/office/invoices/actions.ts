"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { deleteInvoiceOperation, markInvoicePaidOperation, reopenInvoiceOperation, saveInvoiceOperation } from "./operations";

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
