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
export const setOrderStatus = defineAction(setStatusOperation, { revalidate: (data) => pages(data.id), message: "common.saved" });

export const closeOrder = defineAction(closeOrderOperation, { revalidate: (data) => pages(data.id), message: "orders.notices.closed" });

export const reopenOrder = defineAction(reopenOrderOperation, { revalidate: (data) => pages(data.id), message: "orders.notices.reopened" });

export const saveOrderItems = defineAction(saveItemsOperation, { revalidate: (data) => pages(data.id), message: "common.saved" });

export const addOrderFinding = defineAction(addFindingOperation, { revalidate: (data) => pages(data.id), message: "common.saved" });

export const removeOrderFinding = defineAction(removeFindingOperation, { revalidate: (data) => pages(data.id), message: "common.deleted" });

export const approveOrder = defineAction(approveOperation, { form: formObject, revalidate: (data) => pages(data.orderId), message: "orders.notices.approved" });
