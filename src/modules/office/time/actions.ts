"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { addManualTimeOperation, correctTimeOperation, saveTimeSettingsOperation, startTimeOperation, stopTimeOperation, transferTimeOperation, voidTimeOperation } from "./operations";

const pages = ["/time", "/time/entries", "/time/team", "/"];

/** Stempeln: Beginn (der Stempel-Knopf ruft die Aktion direkt auf und reicht den Idempotenzschlüssel als Feld `key` mit). */
export const startTime = defineAction(startTimeOperation, { revalidate: pages });

export const stopTime = defineAction(stopTimeOperation, { revalidate: pages });

export const correctTime = defineAction(correctTimeOperation, {
  revalidate: (data) => [...pages, `/time/entries/${data.id}`],
  redirect: (data) => `/time/entries/${data.id}`,
  message: "time.notices.corrected",
});

export const voidTime = defineAction(voidTimeOperation, {
  revalidate: (data) => [...pages, `/time/entries/${data.id}`],
  redirect: (data) => `/time/entries/${data.id}`,
  message: "time.notices.voided",
});

export const addManualTime = defineAction(addManualTimeOperation, { revalidate: pages, redirect: (data) => `/time/entries/${data.id}`, message: "time.notices.added" });

/** Zeiten eines Auftrags als Arbeitspositionen übernehmen (Knopf im Abschnitt „Zeiten“ der Auftragsseite). */
export const transferTime = defineAction(transferTimeOperation, {
  form: formObject,
  revalidate: (data) => [...pages, `/orders/${data.orderId}`, "/orders"],
  message: "time.notices.transferred",
});

export const saveTimeSettings = defineAction(saveTimeSettingsOperation, { form: formObject, revalidate: [["/", "layout"]], message: "common.saved" });
