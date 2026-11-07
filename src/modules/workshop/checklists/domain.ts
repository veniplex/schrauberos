import { HINT_MAX, LABEL_MAX, MAX_OPTIONS, NUMBER_LIMIT, NUMERIC_TYPES, OPTION_MAX, TEXT_MAX, type ItemType } from "./constants";

/**
 * Reine Regeln der Checklisten (ohne Datenbank, getestet): Auswahlfelder, Prüfung einer Antwort je Punktart, Pflichtpunkte, Messwerte außerhalb der Grenzen, Namensvergleich der Unterschrift.
 */

export type ItemDef = {
  label: string;
  type: ItemType;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  targetValue: number | null;
  /** Auswahlmöglichkeiten, eine je Zeile */
  options: string | null;
  required: boolean;
  hint: string | null;
};

/** Stand eines Punktes aus der Datenbank (`type` ist dort ein Text). */
export type ItemState = Pick<ItemDef, "minValue" | "maxValue" | "options" | "required"> & { type: string; done: boolean; numberValue: number | null; textValue: string | null };

/** Die Auswahlmöglichkeiten eines Punktes (eine je Zeile, getrimmt, ohne Leere und Doppelte). */
export function parseOptions(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].slice(0, MAX_OPTIONS);
}

export const isNumericType = (type: string): boolean => (NUMERIC_TYPES as readonly string[]).includes(type);

export type Answer = { done?: boolean; numberValue?: number | null; textValue?: string | null };
export type Checked = { ok: true; done: boolean; numberValue: number | null; textValue: string | null } | { ok: false; field: "numberValue" | "textValue" | "done"; key: string };

/**
 * Prüft eine Antwort zu einem Punkt und liefert den zu speichernden Stand:
 *  - `check`/`photo`: nur der Haken;
 *  - `measure`/`torque`: eine Zahl (endlich, im Betrag begrenzt); „erledigt“ gilt nur mit Zahl, eine eingetragene Zahl macht den Punkt erledigt; Werte außerhalb von Mindest-/Höchstwert sind erlaubt (sie werden markiert, nicht gesperrt);
 *  - `choice`: ein Eintrag der Auswahl; `text`: Freitext (begrenzt).
 * Löschen eines Wertes (leer) nimmt auch das „erledigt“ zurück.
 */
export function checkAnswer(item: { type: string; options: string | null }, answer: Answer): Checked {
  switch (item.type) {
    case "check":
    case "photo":
      return { ok: true, done: answer.done === true, numberValue: null, textValue: null };
    case "measure":
    case "torque": {
      const value = answer.numberValue ?? null;
      if (value === null) return answer.done ? { ok: false, field: "numberValue", key: "checklists.errors.valueRequired" } : { ok: true, done: false, numberValue: null, textValue: null };
      if (!Number.isFinite(value) || Math.abs(value) > NUMBER_LIMIT) return { ok: false, field: "numberValue", key: "validation.invalid" };
      return { ok: true, done: true, numberValue: Math.round(value * 1000) / 1000, textValue: null };
    }
    case "choice": {
      const value = (answer.textValue ?? "").trim();
      if (value === "") return answer.done ? { ok: false, field: "textValue", key: "checklists.errors.valueRequired" } : { ok: true, done: false, numberValue: null, textValue: null };
      if (!parseOptions(item.options).includes(value)) return { ok: false, field: "textValue", key: "validation.invalid" };
      return { ok: true, done: true, numberValue: null, textValue: value };
    }
    case "text": {
      const value = (answer.textValue ?? "").replace(/\r\n/g, "\n").trim();
      if (value === "") return answer.done ? { ok: false, field: "textValue", key: "checklists.errors.valueRequired" } : { ok: true, done: false, numberValue: null, textValue: null };
      if ([...value].length > TEXT_MAX) return { ok: false, field: "textValue", key: "validation.tooLong" };
      return { ok: true, done: true, numberValue: null, textValue: value };
    }
    default:
      return { ok: false, field: "done", key: "validation.invalid" };
  }
}

/** Liegt der Messwert außerhalb von Mindest- oder Höchstwert? (Hinweis, keine Sperre) */
export function outOfRange(item: Pick<ItemState, "type" | "minValue" | "maxValue" | "numberValue">): boolean {
  if (!isNumericType(item.type) || item.numberValue === null) return false;
  return (item.minValue !== null && item.numberValue < item.minValue) || (item.maxValue !== null && item.numberValue > item.maxValue);
}

/** Pflichtpunkte, die noch offen sind. Nicht erforderliche Punkte bleiben beim Abschluss frei. */
export const openRequired = <T extends Pick<ItemState, "required" | "done">>(items: readonly T[]): T[] => items.filter((item) => item.required && !item.done);

export const progress = (items: readonly Pick<ItemState, "done">[]): { done: number; total: number } => ({ done: items.filter((i) => i.done).length, total: items.length });

/** Name zum Vergleichen: NFKC, ohne Steuerzeichen und überzählige Leerzeichen, klein geschrieben (wie die Freigabe bei Aufträgen). */
export const normalizeName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("de");
export const sameName = (a: string, b: string): boolean => normalizeName(a) !== "" && normalizeName(a) === normalizeName(b);

/** Inhaltsgleichheit zweier Punktlisten (Vorlage speichern ohne Änderung erzeugt keine neue Version). */
export function sameItems(a: readonly ItemDef[], b: readonly ItemDef[]): boolean {
  if (a.length !== b.length) return false;
  const key = (i: ItemDef) => JSON.stringify([i.label, i.type, i.unit, i.minValue, i.maxValue, i.targetValue, parseOptions(i.options), i.required, i.hint]);
  return a.every((item, index) => key(item) === key(b[index]));
}

/** Prüft eine Punktdefinition der Vorlage (Texte, Grenzen, Auswahl); liefert Feld und Meldungsschlüssel oder null. */
export function itemDefProblem(item: ItemDef): { field: string; key: string } | null {
  if (item.label.trim() === "" || [...item.label].length > LABEL_MAX) return { field: "label", key: "validation.invalid" };
  if (item.hint && [...item.hint].length > HINT_MAX) return { field: "hint", key: "validation.tooLong" };
  if (item.type === "choice") {
    const options = parseOptions(item.options);
    if (options.length < 2) return { field: "options", key: "checklists.errors.optionsNeeded" };
    if (options.some((o) => [...o].length > OPTION_MAX)) return { field: "options", key: "validation.tooLong" };
  }
  if (isNumericType(item.type)) {
    for (const [field, value] of [["minValue", item.minValue], ["maxValue", item.maxValue], ["targetValue", item.targetValue]] as const) {
      if (value !== null && (!Number.isFinite(value) || Math.abs(value) > NUMBER_LIMIT)) return { field, key: "validation.invalid" };
    }
    if (item.minValue !== null && item.maxValue !== null && item.minValue > item.maxValue) return { field: "maxValue", key: "checklists.errors.rangeOrder" };
  }
  return null;
}
