"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { addFindingOperation, approveOperation, closeOrderOperation, createOrderOperation, removeFindingOperation, reopenOrderOperation, saveItemsOperation, setStatusOperation, updateOrderOperation } from "./operations";

const pages = (id: string) => ["/orders", "/", `/orders/${id}`, "/appointments", "/parts"];

/** Auftrag anlegen (aus Fahrzeug, Termin oder frei); ein niedrigerer Kilometerstand als im Fahrzeug ist ein Hinweis, kein Fehler. */
export const createOrder = defineAction(createOrderOperation, {
  revalidate: ["/orders", "/"],
  redirect: (data) => `/orders/${data.id}`,
  message: (data) => (data.mileage === "keep" ? "orders.notices.mileageKept" : "orders.notices.created"),
});

export const updateOrder = defineAction(updateOrderOperation, {
  revalidate: (data) => pages(data.id),
  redirect: (data) => `/orders/${data.id}`,
  message: (data) => (data.mileage === "keep" ? "orders.notices.mileageKept" : "common.saved"),
});

/** Ein Schritt der Statuskette (Formular mit `id`, `version`, `status`). */
const STATUS_NOTICE = {
  accepted: "orders.notices.toAccepted",
  in_progress: "orders.notices.toInProgress",
  ready: "orders.notices.toReady",
  picked_up: "orders.notices.closed",
  cancelled: "orders.notices.toCancelled",
} as const;

// Die Meldung nennt den Auftrag und was geschah (Z6-5 M7): „Auftrag A-2026-0007: Arbeit begonnen.“ statt „Gespeichert.“
export const setOrderStatus = defineAction(setStatusOperation, {
  revalidate: (data) => pages(data.id),
  message: (data) => ({ key: STATUS_NOTICE[data.status as keyof typeof STATUS_NOTICE] ?? "orders.notices.closed", params: { number: data.number } }),
});

export const closeOrder = defineAction(closeOrderOperation, { revalidate: (data) => pages(data.id), message: (data) => ({ key: "orders.notices.closed", params: { number: data.number } }) });

export const reopenOrder = defineAction(reopenOrderOperation, { revalidate: (data) => pages(data.id), message: (data) => ({ key: "orders.notices.reopened", params: { number: data.number } }) });

export const saveOrderItems = defineAction(saveItemsOperation, { revalidate: (data) => pages(data.id), message: (data) => ({ key: "orders.notices.itemsSaved", params: { number: data.number } }) });

export const addOrderFinding = defineAction(addFindingOperation, { revalidate: (data) => pages(data.id), message: (data) => ({ key: "orders.notices.findingAdded", params: { number: data.number } }) });

export const removeOrderFinding = defineAction(removeFindingOperation, { revalidate: (data) => pages(data.id), message: "orders.notices.findingRemoved" });

export const approveOrder = defineAction(approveOperation, { form: formObject, revalidate: (data) => pages(data.orderId), message: "orders.notices.approved" });
