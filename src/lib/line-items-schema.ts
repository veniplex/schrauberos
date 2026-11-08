import { z } from "zod";
import { MAX_LINES, MAX_QUANTITY_MILLI, MAX_UNIT_CENTS, computeTotals, lineExceedsLimit } from "./line-items";

// Die Eingabeschemas liegen bewusst getrennt von der Rechnerei in `line-items.ts`: Der Editor (Browser) braucht nur die Rechnerei, zod gehört nicht ins Browserbündel.

/**
 * Eingabeschema für die Positionen im Absendefeld (`serializeSubmit`) – Formular-Aktion **und** API verwenden es, danach rechnet `computeTotals`. Fehler tragen Meldungsschlüssel
 * (`validation.*`); das Feld der Zeile steht im Pfad (`items.2.unitCents` → Fehler an Position 3).
 */
export const lineItemsInput = (options: { max?: number } = {}) =>
  z
    .string()
    .max(200_000)
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "validation.invalid" });
        return z.NEVER;
      }
    })
    .pipe(lineItemsSchema(options));

export const lineItemsSchema = (options: { max?: number } = {}) =>
  z
    .array(
      z.object({
        description: z.string().trim().min(1, { error: "validation.required" }).max(300),
        unit: z.string().trim().max(20).default(""),
        quantityMilli: z.number({ error: "validation.number" }).int().min(-MAX_QUANTITY_MILLI).max(MAX_QUANTITY_MILLI),
        unitCents: z.number({ error: "validation.invalid" }).int().min(-MAX_UNIT_CENTS).max(MAX_UNIT_CENTS),
        taxBp: z.number({ error: "validation.number" }).int().min(0).max(10_000),
        discountBp: z.number({ error: "validation.number" }).int().min(0).max(10_000).default(0),
        /** Zusätze, die nur der Aufrufer deutet (Art der Position, Verweis auf einen Artikel) */
        kind: z.string().max(20).optional(),
        refType: z.string().max(20).optional(),
        refId: z.string().max(64).optional(),
      }),
    )
    .max(options.max ?? MAX_LINES)
    .superRefine((items, ctx) => {
      // Betragsgrenze (Int-Spalten, exakte Summen): erst jede Position, dann die Summen – nie ein stiller Überlauf
      let lineIssue = false;
      items.forEach((item, index) => {
        if (!lineExceedsLimit(item)) return;
        lineIssue = true;
        ctx.addIssue({ code: "custom", path: [index, "unitCents"], message: "validation.tooLarge" });
      });
      // schlimmster Fall (Steuer nicht ausgenommen): Brutto ist am größten
      if (!lineIssue && computeTotals(items).exceedsLimit) ctx.addIssue({ code: "custom", message: "validation.tooLarge" });
    });
