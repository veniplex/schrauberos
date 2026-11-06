import { z } from "zod";
import { isCalendarDay } from "./dates";
import { parseMoneyToCents } from "./money";

/**
 * Wiederverwendbare Feldschemas für die Eingabe von Operationen. Fehler tragen Meldungsschlüssel (siehe `fieldErrors` in
 * `src/server/operations/errors.ts`), keine fertigen Texte.
 */

/** Geldbetrag als Text („1.234,56“, „12.50“) → ganze Cent. `invalidKey`: Meldungsschlüssel bei ungültiger Eingabe. */
export const moneyCents = (invalidKey: string, max = 20) =>
  z
    .string()
    .max(max)
    .transform((value, ctx) => {
      const cents = parseMoneyToCents(value);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: invalidKey });
        return z.NEVER;
      }
      return cents;
    });

/** Kalendertag als Text `JJJJ-MM-TT` (Formularfeld `type="date"`) – ein echter Tag (`isCalendarDay`), nicht nur die Form. Gilt für Formulare **und** API. */
export const dateText = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDay);
