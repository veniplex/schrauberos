"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import {
  acceptOfferOperation,
  addPaymentOperation,
  createConfirmationOperation,
  deleteDraftOperation,
  finalizeDocumentOperation,
  invoiceFromOrderOperation,
  issueDocumentOperation,
  orderFromOfferOperation,
  refreshRecipientOperation,
  rejectOfferOperation,
  removePaymentOperation,
  saveDraftOperation,
  sendDocumentOperation,
} from "./operations";

const paths = (id: string) => ["/billing", "/invoices", "/", `/billing/${id}`, `/invoices/${id}`] as const;
const flag = (value: FormDataEntryValue | null): boolean => value === "on" || value === "1" || value === "true";

export const saveDraft = defineAction(saveDraftOperation, {
  form: (fd) => ({ ...formObject(fd), deductPartialIds: fd.getAll("deductPartialIds").map(String) }),
  revalidate: ({ id }) => paths(id),
  redirect: ({ id }) => `/billing/${id}`,
  message: "billing.flash.saved",
});

export const refreshRecipient = defineAction(refreshRecipientOperation, { revalidate: ({ id }) => paths(id), message: "billing.flash.recipientRefreshed" });

export const deleteDraft = defineAction(deleteDraftOperation, { revalidate: ["/billing", "/"], redirect: "/billing", message: "common.deleted" });

export const finalizeDocument = defineAction(finalizeDocumentOperation, { revalidate: ({ id }) => paths(id), message: ({ number }) => ({ key: "billing.flash.finalized", params: { number } }) });
export const issueDocument = defineAction(issueDocumentOperation, { revalidate: ({ id }) => paths(id), message: ({ number }) => ({ key: "billing.flash.issued", params: { number } }) });

export const acceptOffer = defineAction(acceptOfferOperation, { revalidate: ({ id }) => paths(id), message: "billing.flash.accepted" });
export const rejectOffer = defineAction(rejectOfferOperation, { revalidate: ({ id }) => paths(id), message: "billing.flash.rejected" });

export const createConfirmation = defineAction(createConfirmationOperation, { revalidate: ({ id }) => paths(id), redirect: ({ id }) => `/billing/${id}`, message: "billing.flash.confirmationCreated" });
export const orderFromOffer = defineAction(orderFromOfferOperation, {
  revalidate: ({ id, orderId }) => [...paths(id), "/orders", `/orders/${orderId}`],
  redirect: ({ orderId }) => `/orders/${orderId}`,
  message: "billing.flash.orderCreated",
});

export const invoiceFromOrder = defineAction(invoiceFromOrderOperation, {
  form: (fd) => ({ ...formObject(fd), confirmOpen: flag(fd.get("confirmOpen")), acknowledgeDuplicate: flag(fd.get("acknowledgeDuplicate")) }),
  revalidate: ({ id }) => paths(id),
  redirect: ({ id }) => `/billing/${id}`,
  message: "billing.flash.invoiceFromOrder",
  redirectOnError: (fd) => `/billing/new?order=${encodeURIComponent(String(fd.get("orderId") ?? ""))}`,
});

export const addPayment = defineAction(addPaymentOperation, { revalidate: ({ id }) => paths(id), message: "billing.flash.paymentAdded" });
export const removePayment = defineAction(removePaymentOperation, { revalidate: ({ id }) => paths(id), message: "billing.flash.paymentRemoved" });

export const sendDocument = defineAction(sendDocumentOperation, {
  form: (fd) => ({ ...formObject(fd), includeXml: flag(fd.get("includeXml")), resend: flag(fd.get("resend")) }),
  revalidate: ({ id }) => paths(id),
  message: "billing.flash.sent",
});
