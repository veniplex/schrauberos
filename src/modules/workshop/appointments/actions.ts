"use server";

import { formObject, safeReturn } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { type AppointmentInput, createAppointmentOperation, deleteAppointmentOperation, deleteBayOperation, deleteTypeOperation, saveBayOperation, saveSettingsOperation, saveTypeOperation, updateAppointmentOperation } from "./operations";

const refresh = ["/appointments", "/", "/tires"] as const;

const afterSave = {
  form: formObject,
  revalidate: [...refresh],
  redirect: (_data: unknown, input: AppointmentInput) => safeReturn(input.returnTo, "/appointments", `/appointments?date=${input.date}`),
};

/** Neuen Termin anlegen (Formular ohne `id`). */
export const createAppointment = defineAction(createAppointmentOperation, afterSave);

/** Bestehenden Termin ändern (Formular mit `id` und `version`). */
export const updateAppointment = defineAction(updateAppointmentOperation, afterSave);

export const deleteAppointment = defineAction(deleteAppointmentOperation, {
  revalidate: [...refresh],
  redirect: (_data, input) => safeReturn(input.returnTo, "/appointments", "/appointments"),
  message: "common.deleted",
  redirectOnError: (formData) => safeReturn(String(formData.get("returnTo") ?? ""), "/appointments", "/appointments"),
});

export const saveAppointmentSettings = defineAction(saveSettingsOperation, { form: formObject, revalidate: ["/appointments"], message: "common.saved" });

export const saveBay = defineAction(saveBayOperation, {
  form: (fd) => ({ ...formObject(fd), active: fd.get("active") === "on" }),
  revalidate: ["/appointments"],
  message: "common.saved",
});

export const deleteBay = defineAction(deleteBayOperation, { revalidate: ["/appointments"], message: "common.deleted" });

export const saveAppointmentType = defineAction(saveTypeOperation, {
  form: (fd) => ({ ...formObject(fd), active: fd.get("active") === "on" }),
  revalidate: ["/appointments"],
  message: "common.saved",
});

export const deleteAppointmentType = defineAction(deleteTypeOperation, { revalidate: ["/appointments"], message: "common.deleted" });
