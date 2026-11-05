import type { ZodError } from "zod";
import type { Translator } from "@/i18n/translate";

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

/** Zod-Fehler -> { feldname: übersetzte Meldung }. */
export function fieldErrors(error: ZodError, t: Translator["t"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (out[key]) continue;
    // Leere Felder werden vorab entfernt (formObject) -> fehlender Wert = Pflichtfeld
    out[key] =
      issue.code === "invalid_type" ? t("validation.required") : issue.code === "too_big" ? t("validation.tooLong") : t("validation.invalid");
  }
  return out;
}

/** Nur interne Rücksprung-Pfade mit erwartetem Präfix zulassen. */
export function safeReturn(value: string | undefined, prefix: string, fallback: string): string {
  return value && value.startsWith(prefix) && !value.startsWith("//") ? value : fallback;
}
