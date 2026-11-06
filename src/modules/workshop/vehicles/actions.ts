"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { deleteVehicleOperation, saveVehicleOperation, transferVehicleOperation } from "./operations";

const refreshPaths = (id?: string) => [...["/vehicles", "/customers", "/tires", "/appointments", "/"], ...(id ? [`/vehicles/${id}`] : [])];

export const saveVehicle = defineAction(saveVehicleOperation, {
  form: formObject,
  revalidate: ({ id }) => refreshPaths(id),
  redirect: ({ id }) => `/vehicles/${id}`,
});

export const transferVehicle = defineAction(transferVehicleOperation, {
  form: formObject,
  revalidate: ({ id }) => refreshPaths(id),
  redirect: ({ id }) => `/vehicles/${id}`,
});

export const deleteVehicle = defineAction(deleteVehicleOperation, {
  revalidate: () => refreshPaths(),
  redirect: "/vehicles",
  message: "common.deleted",
});
