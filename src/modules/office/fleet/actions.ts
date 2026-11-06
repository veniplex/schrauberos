"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { addCostOperation, addMileageOperation, deleteCostOperation, deleteFleetVehicleOperation, deleteLicenseCheckOperation, deleteMileageOperation, saveFleetVehicleOperation, saveLicenseCheckOperation } from "./operations";

const refreshPaths = ["/fleet", "/fleet/licenses", "/"];
const refresh = (id?: string | null) => [...refreshPaths, ...(id ? [`/fleet/${id}`] : [])];

export const saveFleetVehicle = defineAction(saveFleetVehicleOperation, { form: formObject, revalidate: ({ id }) => refresh(id), redirect: ({ id }) => `/fleet/${id}` });

export const deleteFleetVehicle = defineAction(deleteFleetVehicleOperation, { revalidate: refresh(), redirect: "/fleet", message: "common.deleted" });

export const addMileage = defineAction(addMileageOperation, { form: formObject, revalidate: (_data, input) => refresh(input.fleetVehicleId), message: "common.saved" });

export const deleteMileage = defineAction(deleteMileageOperation, { revalidate: ({ fleetVehicleId }) => refresh(fleetVehicleId), message: "common.deleted" });

export const addCost = defineAction(addCostOperation, { form: formObject, revalidate: (_data, input) => refresh(input.fleetVehicleId), message: "common.saved" });

export const deleteCost = defineAction(deleteCostOperation, { revalidate: ({ fleetVehicleId }) => refresh(fleetVehicleId), message: "common.deleted" });

export const saveLicenseCheck = defineAction(saveLicenseCheckOperation, { form: formObject, revalidate: refresh(), redirect: "/fleet/licenses" });

export const deleteLicenseCheck = defineAction(deleteLicenseCheckOperation, { revalidate: refresh(), message: "common.deleted" });
