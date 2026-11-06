"use server";

import { formObject, safeReturn } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { deleteConnectionOperation, deleteDeviceOperation, deleteIpOperation, deleteLocationOperation, deleteSubnetOperation, deleteVlanOperation, saveConnectionOperation, saveDeviceOperation, saveIpOperation, saveLocationOperation, saveSubnetOperation, saveVlanOperation } from "./operations";

const NETWORK_PATHS = ["/network", "/network/devices", "/network/ip", "/network/cabling", "/"];
const refresh = (...extra: string[]) => [...NETWORK_PATHS, ...extra];

export const saveDevice = defineAction(saveDeviceOperation, {
  form: (fd) => ({ ...formObject(fd), monitorEnabled: fd.get("monitorEnabled") === "on" }),
  revalidate: refresh(),
  redirect: ({ id }) => `/network/devices/${id}`,
});

export const deleteDevice = defineAction(deleteDeviceOperation, { revalidate: refresh(), redirect: "/network/devices", message: "common.deleted" });

export const saveVlan = defineAction(saveVlanOperation, { form: formObject, revalidate: refresh(), message: "common.saved" });

export const deleteVlan = defineAction(deleteVlanOperation, { revalidate: refresh(), message: "common.deleted" });

export const saveSubnet = defineAction(saveSubnetOperation, { form: formObject, revalidate: refresh(), redirect: ({ id }) => `/network/ip/${id}` });

export const deleteSubnet = defineAction(deleteSubnetOperation, { revalidate: refresh(), redirect: "/network/ip", message: "common.deleted" });

export const saveIp = defineAction(saveIpOperation, {
  form: formObject,
  revalidate: refresh(),
  redirect: ({ subnetId }, input) => safeReturn(input.returnTo, "/network/ip", `/network/ip/${subnetId}`),
});

export const deleteIp = defineAction(deleteIpOperation, {
  revalidate: refresh(),
  redirect: (_data, input) => safeReturn(input.returnTo, "/network/ip", "/network/ip"),
  message: "common.deleted",
  redirectOnError: (formData) => safeReturn(String(formData.get("returnTo") ?? ""), "/network/ip", "/network/ip"),
});

export const saveLocation = defineAction(saveLocationOperation, { form: formObject, revalidate: refresh(), message: "common.saved" });

export const deleteLocation = defineAction(deleteLocationOperation, { revalidate: refresh(), message: "common.deleted" });

export const saveConnection = defineAction(saveConnectionOperation, { form: formObject, revalidate: refresh(), message: "common.saved" });

export const deleteConnection = defineAction(deleteConnectionOperation, { revalidate: refresh(), message: "common.deleted" });
