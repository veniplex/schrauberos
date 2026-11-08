"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { deleteMonitorTargetOperation, saveMonitorTargetOperation, setMonitoringOperation } from "./monitor-operations";

const PATHS = ["/network", "/network/monitoring", "/network/devices", "/"];

export const saveMonitorTarget = defineAction(saveMonitorTargetOperation, {
  form: (fd) => ({ ...formObject(fd), ignoreTlsErrors: fd.get("ignoreTlsErrors") === "on", enabled: fd.get("enabled") === "on" }),
  revalidate: PATHS,
  redirect: ({ id }) => `/network/monitoring/${id}`,
});

export const deleteMonitorTarget = defineAction(deleteMonitorTargetOperation, { revalidate: PATHS, redirect: "/network/monitoring", message: "common.deleted" });

export const setMonitoring = defineAction(setMonitoringOperation, {
  form: (fd) => ({ enabled: fd.get("enabled") === "on" || fd.get("enabled") === "true" }),
  revalidate: PATHS,
  message: "common.saved",
});
