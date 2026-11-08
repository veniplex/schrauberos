"use server";

import { formObject, safeReturn } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { type AppointmentInput, archiveBayOperation, createFeedOperation, revokeFeedOperation, archiveTypeOperation, createAppointmentOperation, deleteAppointmentOperation, deleteBayOperation, deleteTypeOperation, saveBayOperation, saveSettingsOperation, saveTypeOperation, setAppointmentStatusOperation, updateAppointmentOperation } from "./operations";

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

/**
 * Schnellstatus „Starten“/„Fertig“ (Formular mit `id`, `version`, `status`). Die Antwort trägt den neuen Status (`status`): Die Karte zeigt daran, ob sie nach „Fertig“ den
 * Vorschlag „Reifensatz ein-/ausbuchen?“ stellt.
 */
export const setAppointmentStatus = defineAction(setAppointmentStatusOperation, {
  revalidate: [...refresh, ["/tires/[id]", "page"]],
  message: (_data, input) => (input.status === "done" ? "appointments.quickStatus.doneMessage" : "appointments.quickStatus.startedMessage"),
  state: (data) => ({ status: data.status }),
});

export const deleteAppointment = defineAction(deleteAppointmentOperation, {
  revalidate: [...refresh],
  redirect: (_data, input) => safeReturn(input.returnTo, "/appointments", "/appointments"),
  message: "common.deleted",
  redirectOnError: (formData) => safeReturn(String(formData.get("returnTo") ?? ""), "/appointments", "/appointments"),
});

export const saveAppointmentSettings = defineAction(saveSettingsOperation, { form: formObject, revalidate: ["/appointments", "/admin/settings"], message: "common.saved" });

export const saveBay = defineAction(saveBayOperation, {
  form: formObject,
  revalidate: ["/appointments", "/admin/settings"],
  message: "common.saved",
});

export const deleteBay = defineAction(deleteBayOperation, { revalidate: ["/appointments", "/admin/settings"], message: "common.deleted" });

export const saveAppointmentType = defineAction(saveTypeOperation, {
  form: formObject,
  revalidate: ["/appointments", "/admin/settings"],
  message: "common.saved",
});

export const deleteAppointmentType = defineAction(deleteTypeOperation, { revalidate: ["/appointments", "/admin/settings"], message: "common.deleted" });

/** Archivieren bzw. Wiederaktivieren (Formularfeld `archived` = „1“ oder „0“). */
const archivedForm = (fd: FormData) => ({ id: String(fd.get("id") ?? ""), archived: fd.get("archived") === "1" });

export const archiveBay = defineAction(archiveBayOperation, { form: archivedForm, revalidate: ["/appointments", "/admin/settings"], message: "common.saved" });

export const archiveAppointmentType = defineAction(archiveTypeOperation, { form: archivedForm, revalidate: ["/appointments", "/admin/settings"], message: "common.saved" });

/**
 * Kalender-Abo erzeugen/erneuern: Die Antwort trägt den **Klartext der Abo-Adresse** (`feed.token`, einmalig – nur im Zustand der Seite, nie in URL, Log oder Audit); die Adresse selbst setzt die Seite aus
 * der Einstellung „Adresse der Anwendung“ (oder der geöffneten Adresse) und diesem Token zusammen.
 */
export const createFeed = defineAction(createFeedOperation, {
  form: formObject,
  revalidate: ["/appointments/feed"],
  message: "appointments.feedPage.created",
  state: (data) => ({ feed: { token: data.token } }),
});

export const revokeFeed = defineAction(revokeFeedOperation, { form: formObject, revalidate: ["/appointments/feed"], message: "appointments.feedPage.revoke.done" });
