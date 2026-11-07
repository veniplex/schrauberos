import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import type { ColumnSpec } from "./table";

/** Eine Spalte, wie die Funktionen sie beschreiben: Schlüssel, Beschriftung (Übersetzungsschlüssel) und zusätzliche Schreibweisen der Überschrift. */
export type ColumnDef = {
  key: string;
  labelKey: MessageKey;
  /** weitere erkannte Überschriften (Kürzel, Schreibweisen anderer Programme) */
  aliases?: readonly string[];
  required?: boolean;
  multiline?: boolean;
};

const translators = [createTranslator("de", de), createTranslator("en", en)];

/**
 * Spaltenbeschreibungen → die Spalten, die ein Import erkennt: Die Überschrift darf der technische Schlüssel, die deutsche oder die englische Beschriftung oder ein Alias
 * sein – eine Datei, die in einer Sprache exportiert wurde, lässt sich also in der anderen einlesen.
 */
export function columnSpecs(columns: readonly ColumnDef[]): ColumnSpec[] {
  return columns.map((c) => ({
    key: c.key,
    labelKey: c.labelKey,
    required: c.required,
    multiline: c.multiline,
    names: [...translators.map((t) => t.t(c.labelKey)), ...(c.aliases ?? [])],
  }));
}
