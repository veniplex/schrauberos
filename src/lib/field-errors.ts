import type { ZodError } from "zod";
import type { MessageKey, Vars } from "@/i18n/translate";

/** Eine Feldmeldung als Meldungsschlüssel mit Platzhaltern (übersetzt wird erst im Adapter bzw. im Formular). */
export type FieldMessage = { key: MessageKey; params?: Vars };

const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

/**
 * Zod-Fehler → Feldname → Meldungsschlüssel. Das ist die Code→Schlüssel-Abbildung des Aktions-Rahmens (`fieldErrors()` in `src/server/operations/errors.ts`); die Texte
 * stehen in `validation.*` (DE/EN), die Darstellung liefert `Field`/`FormErrorSummary`.
 *
 * - **Eigener Schlüssel gewinnt:** Trägt ein Prüfschritt einen Meldungsschlüssel als Fehlertext (`.regex(re, { error: "validation.vin" })`, `ctx.addIssue({ code: "custom",
 *   message: "account.errors.passwordShort", params: { min: 8 } })`), gilt er – mit `params` als Platzhaltern.
 * - Sonst nach Art des Fehlers: Pflichtfeld (fehlender Wert – leere Formularfelder fehlen vorab), E-Mail-Format, Zahl/ganze Zahl, Zahlenbereich (`numberMin`/`numberMax`
 *   mit Grenze), Länge (`tooShort`/`tooLong` mit Grenze), sonst „ungültig“.
 */
export function fieldMessages(error: ZodError): Record<string, FieldMessage> {
  const out: Record<string, FieldMessage> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "_");
    if (out[field]) continue;
    if (KEY_SHAPE.test(issue.message)) {
      out[field] = { key: issue.message as MessageKey, params: (issue as { params?: Vars }).params };
      continue;
    }
    out[field] = classify(issue);
  }
  return out;
}

type Issue = ZodError["issues"][number];

function classify(issue: Issue): FieldMessage {
  switch (issue.code) {
    case "invalid_type":
      return { key: issue.expected === "number" ? "validation.number" : issue.expected === "int" ? "validation.integer" : "validation.required" };
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") return min <= 1 ? { key: "validation.required" } : { key: "validation.tooShort", params: { min } };
      if (issue.origin === "number" || issue.origin === "int") return { key: "validation.numberMin", params: { min } };
      return { key: "validation.invalid" };
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") return { key: "validation.tooLong", params: { max } };
      if (issue.origin === "number" || issue.origin === "int") return { key: "validation.numberMax", params: { max } };
      return { key: "validation.tooLong", params: { max } };
    }
    case "invalid_format":
      return { key: issue.format === "email" ? "validation.email" : "validation.invalid" };
    default:
      return { key: "validation.invalid" };
  }
}
