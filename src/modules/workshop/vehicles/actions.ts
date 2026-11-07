"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { archiveVehicleOperation, deleteVehicleOperation, saveVehicleOperation, transferVehicleOperation, unarchiveVehicleOperation } from "./operations";

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

export const archiveVehicle = defineAction(archiveVehicleOperation, { revalidate: ({ id }) => refreshPaths(id), redirect: ({ id }) => `/vehicles/${id}`, message: "archive.archived" });

export const unarchiveVehicle = defineAction(unarchiveVehicleOperation, { revalidate: ({ id }) => refreshPaths(id), redirect: ({ id }) => `/vehicles/${id}`, message: "archive.unarchived" });

export const deleteVehicle = defineAction(deleteVehicleOperation, {
  revalidate: () => refreshPaths(),
  redirect: "/vehicles",
  message: "common.deleted",
});
