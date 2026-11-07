"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { deleteCustomerOperation, saveCustomerOperation } from "./operations";

export const saveCustomer = defineAction(saveCustomerOperation, {
  form: formObject,
  revalidate: ["/customers"],
  redirect: ({ id }) => `/customers/${id}`,
  // „Speichern und Fahrzeug anlegen“: weiter zum Fahrzeugformular mit dem neuen Kunden als Halter
  redirectNext: ({ id }) => `/vehicles/new?customer=${id}`,
});

export const deleteCustomer = defineAction(deleteCustomerOperation, {
  revalidate: ["/customers", "/tires", "/vehicles"],
  redirect: "/customers",
  message: "common.deleted",
});
