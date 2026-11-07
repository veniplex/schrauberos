import type { ZodError } from "zod";
import type { Translator } from "@/i18n/translate";
import { fieldMessages } from "./field-errors";

/** FormData-Feld als getrimmter String; leer => undefined. */
export function str(fd: FormData, name: string): string | undefined {
  const v = fd.get(name);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** FormData -> einfaches Objekt (leere Felder entfallen). */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of new Set(fd.keys())) {
    const v = str(fd, key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Zod-Fehler -> { feldname: übersetzte Meldung } (für die Aktionen vor der Sitzung: Anmeldung, Einrichtung, Notzugang). Abbildung: `fieldMessages`. */
export function fieldErrors(error: ZodError, t: Translator["t"]): Record<string, string> {
  return Object.fromEntries(Object.entries(fieldMessages(error)).map(([name, m]) => [name, t(m.key, m.params)]));
}

/** Nur interne Rücksprung-Pfade mit erwartetem Präfix zulassen. */
export function safeReturn(value: string | undefined, prefix: string, fallback: string): string {
  return value && value.startsWith(prefix) && !value.startsWith("//") ? value : fallback;
}
