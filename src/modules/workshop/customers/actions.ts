"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { archiveCustomerOperation, deleteCustomerOperation, saveCustomerOperation, unarchiveCustomerOperation } from "./operations";

export const saveCustomer = defineAction(saveCustomerOperation, {
  form: formObject,
  revalidate: ["/customers"],
  redirect: ({ id }) => `/customers/${id}`,
  // „Speichern und Fahrzeug anlegen“: weiter zum Fahrzeugformular mit dem neuen Kunden als Halter – nur, wenn die Person Fahrzeuge anlegen darf (ausgeschaltete Funktion = kein
  // Recht in der Sitzung); sonst bleibt es beim normalen Weg zur Kundenseite statt bei einer Fehlerseite
  redirectNext: ({ id }, _input, principal) => (principal.can("vehicles.edit") ? `/vehicles/new?customer=${id}` : undefined),
});

export const archiveCustomer = defineAction(archiveCustomerOperation, { revalidate: ["/customers", "/vehicles", "/appointments"], redirect: ({ id }) => `/customers/${id}`, message: "archive.archived" });

export const unarchiveCustomer = defineAction(unarchiveCustomerOperation, { revalidate: ["/customers", "/vehicles", "/appointments"], redirect: ({ id }) => `/customers/${id}`, message: "archive.unarchived" });

export const deleteCustomer = defineAction(deleteCustomerOperation, {
  revalidate: ["/customers", "/tires", "/vehicles"],
  redirect: "/customers",
  message: "common.deleted",
});
