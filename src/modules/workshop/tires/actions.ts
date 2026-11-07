"use server";

import { formObject } from "@/lib/forms";
import { TIRE_POSITIONS } from "@/modules/workshop/tires/constants";
import type { RawTireRow } from "@/modules/workshop/tires/domain";
import { defineAction } from "@/server/operations";
import { createTireSetOperation, deleteTireSetOperation, disposeOperation, saveSettingsOperation, setStatusOperation, updateTireSetOperation } from "./operations";

/** Formular → Eingabe: die Einzelreifen werden aus den flachen Feldnamen gesammelt. */
function tireSetForm(fd: FormData): unknown {
  const raw = formObject(fd);
  const tires: Record<string, RawTireRow> = {};
  for (const position of TIRE_POSITIONS) tires[position] = { dot: raw[`tire.${position}.dot`], tread: raw[`tire.${position}.tread`], condition: raw[`tire.${position}.condition`] };
  return { ...raw, spare: fd.get("spare") !== null, tires };
}

const afterSave = {
  form: tireSetForm,
  revalidate: (data: { id: string }) => ["/tires", "/", `/tires/${data.id}`],
  redirect: (data: { id: string }) => `/tires/${data.id}`,
};

/** Neuen Reifensatz anlegen (Formular ohne `id`). */
export const createTireSet = defineAction(createTireSetOperation, afterSave);

/** Reifensatz ändern (Formular mit `id` und `version`). */
export const updateTireSet = defineAction(updateTireSetOperation, afterSave);

const afterStatus = { revalidate: ({ id }: { id: string }) => ["/tires", "/", `/tires/${id}`, "/appointments"], message: "common.saved" } as const;

/** Satz ein-/ausbuchen (Recht `tires.stock`, Formular mit `id`, `version`, `status`): auch als Vorschlag nach einem erledigten Wechseltermin. */
export const setTireSetStatus = defineAction(setStatusOperation, afterStatus);

/** Satz als entsorgt markieren (Recht `tires.edit`, Formular mit `id` und `version`). */
export const disposeTireSet = defineAction(disposeOperation, afterStatus);

export const deleteTireSet = defineAction(deleteTireSetOperation, { revalidate: ["/tires", "/"], redirect: "/tires", message: "common.deleted" });

export const saveTireSettings = defineAction(saveSettingsOperation, { form: formObject, revalidate: [["/", "layout"]], message: "common.saved" });
