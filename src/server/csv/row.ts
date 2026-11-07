import type { ZodError } from "zod";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { fieldMessages } from "@/lib/field-errors";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import type { RowMessage } from "./import";
import { normalizeHeader } from "./table";

/** Zod-Fehler der Operation → Meldungen je Spalte (dieselben Schlüssel wie im Formular, mit der Spalte davor). */
export function zodRowMessages(error: ZodError): RowMessage[] {
  return Object.entries(fieldMessages(error)).map(([column, message]) => ({ column, key: message.key, params: message.params }));
}

const translators = [createTranslator("de", de), createTranslator("en", en)];

/**
 * Erkennt Werte einer Auswahlspalte: der Code selbst (`petrol`) oder die Beschriftung in einer der beiden Sprachen („Benzin“, „Petrol“), unabhängig von Groß-/Kleinschreibung.
 * `aliases`: weitere Schreibweisen (zum Beispiel „Eingangsrechnung“). Liefert den Code oder `undefined`. So lässt sich eine Datei einlesen, die in lesbarer Form exportiert wurde.
 */
export function enumParser<C extends string>(codes: readonly C[], labelKey: (code: C) => MessageKey, aliases: Readonly<Record<string, C>> = {}): (value: string) => C | undefined {
  const byName = new Map<string, C>();
  for (const code of codes) {
    byName.set(normalizeHeader(code), code);
    for (const tr of translators) byName.set(normalizeHeader(tr.t(labelKey(code))), code);
  }
  for (const [alias, code] of Object.entries(aliases)) byName.set(normalizeHeader(alias), code);
  return (value) => byName.get(normalizeHeader(value));
}
