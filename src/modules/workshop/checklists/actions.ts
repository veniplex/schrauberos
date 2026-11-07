"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import {
  archiveTemplateOperation,
  completeChecklistOperation,
  discardChecklistOperation,
  installDefaultsOperation,
  reopenChecklistOperation,
  saveTemplateOperation,
  setItemOperation,
  startChecklistOperation,
} from "./operations";

const pages = ["/checklists", "/vehicles", "/orders", "/"];

/** Checkliste beginnen (Formular `/checklists/new`, Knopf „Annahmeprotokoll starten“): danach auf die Checkliste. */
export const startChecklist = defineAction(startChecklistOperation, {
  revalidate: pages,
  redirect: (data) => `/checklists/${data.id}`,
  message: "checklists.notices.started",
});

/**
 * Ein Punkt (Haken, Messwert, Auswahl, Text): wird von der Checkliste direkt aufgerufen und liefert die neue Version des Punkts in der Antwort (`version`), damit das nächste Speichern ohne Neuladen gelingt.
 * Keine Seiten werden neu geladen – die Checkliste hält ihren Stand selbst.
 */
export const setChecklistItem = defineAction(setItemOperation, { form: formObject, state: (data) => ({ version: data.version, done: data.done }) });

export const completeChecklist = defineAction(completeChecklistOperation, {
  revalidate: (data) => [...pages, `/checklists/${data.id}`],
  redirect: (data) => `/checklists/${data.id}`,
  message: "checklists.notices.completed",
});

export const reopenChecklist = defineAction(reopenChecklistOperation, {
  revalidate: (data) => [...pages, `/checklists/${data.id}`],
  redirect: (data) => `/checklists/${data.id}`,
  message: "checklists.notices.reopened",
});

export const discardChecklist = defineAction(discardChecklistOperation, { revalidate: pages, redirect: () => "/checklists", message: "checklists.notices.discarded" });

export const saveTemplate = defineAction(saveTemplateOperation, {
  revalidate: ["/checklists/templates", "/checklists"],
  redirect: (data) => `/checklists/templates/${data.id}`,
  message: (data) => (data.changed ? "checklists.notices.templateSaved" : "checklists.notices.templateUnchanged"),
});

export const archiveTemplate = defineAction(archiveTemplateOperation, { revalidate: ["/checklists/templates", "/checklists"], message: "common.saved" });

export const installDefaults = defineAction(installDefaultsOperation, { revalidate: ["/checklists/templates", "/checklists"], message: "checklists.notices.defaultsInstalled" });
