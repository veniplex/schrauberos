"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { deleteCustomerOperation, saveCustomerOperation } from "./operations";

export const saveCustomer = defineAction(saveCustomerOperation, {
  form: formObject,
  revalidate: ["/customers"],
  redirect: ({ id }) => `/customers/${id}`,
});

export const deleteCustomer = defineAction(deleteCustomerOperation, {
  revalidate: ["/customers", "/tires", "/vehicles"],
  redirect: "/customers",
  message: "common.deleted",
});
